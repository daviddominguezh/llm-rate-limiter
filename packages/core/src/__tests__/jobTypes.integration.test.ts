/**
 * Integration tests for job types through the full queueJob flow.
 * Verifies that slots are correctly acquired and released in all scenarios.
 */
import { describe, expect, it } from '@jest/globals';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendAcquireContext } from '../multiModelTypes.js';
import { DelegationError } from '../utils/jobExecutionHelpers.js';
import {
  DEFAULT_PRICING,
  FIVE,
  HIGH_RPM,
  HUNDRED,
  ONE,
  RATIO_HALF,
  SHORT_DELAY_MS,
  TEN,
  ZERO,
  createDelayedJob,
  createDelayedThrowingJob,
  createRejectingJob,
  createSimpleTestJob,
  createTestLimiter,
  createThrowingJob,
} from './jobTypes.helpers.js';

describe('Job Types Integration - Slot Release on Completion', () => {
  it('should release slot when queueJob completes normally', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      const statsBefore = limiter.getJobTypeStats();
      expect(statsBefore?.jobTypes.typeA?.inFlight).toBe(ZERO);

      await limiter.queueJob({
        jobId: 'test-job',
        jobType: 'typeA',
        job: createSimpleTestJob(),
      });

      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Slot Release on Exception', () => {
  it('should release slot when job throws exception', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      const statsBefore = limiter.getJobTypeStats();
      expect(statsBefore?.jobTypes.typeA?.inFlight).toBe(ZERO);

      await expect(
        limiter.queueJob({
          jobId: 'throwing-job',
          jobType: 'typeA',
          job: createThrowingJob('Test error'),
        })
      ).rejects.toThrow('Test error');

      // Slot should be released despite error
      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Slot Release on Rejected Promise', () => {
  it('should release slot when job returns rejected promise', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      await expect(
        limiter.queueJob({
          jobId: 'rejecting-job',
          jobType: 'typeA',
          job: createRejectingJob('Async rejection'),
        })
      ).rejects.toThrow('Async rejection');

      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Model Fallback', () => {
  it('should handle job type + model fallback correctly', async () => {
    // Create limiter with two models, first one always fails
    const limiter = createLLMRateLimiter({
      models: {
        modelA: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
        modelB: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
      order: ['modelA', 'modelB'],
      resourcesPerJob: {
        typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });

    let modelAAttempts = ZERO;

    try {
      const result = await limiter.queueJob({
        jobId: 'fallback-job',
        jobType: 'typeA',
        job: (ctx, resolve) => {
          if (ctx.modelId === 'modelA') {
            modelAAttempts += ONE;
            // Trigger delegation to next model using proper DelegationError
            throw new DelegationError();
          }
          resolve({ modelId: ctx.modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: FIVE });
          return { requestCount: ONE, usage: { input: TEN, output: FIVE, cached: ZERO } };
        },
      });

      // Job should have completed on modelB
      expect(result.modelUsed).toBe('modelB');

      // Slot should be released
      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Memory Manager Interaction', () => {
  it('should handle job type + memory manager interaction', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: 0.5 },
      maxCapacity: HUNDRED,
      models: {
        model1: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          resourcesPerEvent: {
            estimatedNumberOfRequests: ONE,
            estimatedUsedMemoryKB: TEN,
          },
          pricing: DEFAULT_PRICING,
        },
      },
      resourcesPerJob: {
        typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });

    try {
      // Run a job - both job type and memory should be acquired/released
      await limiter.queueJob({
        jobId: 'memory-job',
        jobType: 'typeA',
        job: createDelayedJob(SHORT_DELAY_MS),
      });

      // All resources should be released
      const stats = limiter.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Backend Rejection', () => {
  it('should handle backend rejection with acquired job type slot', async () => {
    let acquireCount = ZERO;
    const rejectingBackend = {
      acquire: async (_ctx: BackendAcquireContext): Promise<boolean> => {
        acquireCount += ONE;
        // Reject all acquire attempts
        return await Promise.resolve(false);
      },
      release: async (): Promise<void> => {
        await Promise.resolve();
      },
    };

    const limiter = createLLMRateLimiter({
      backend: rejectingBackend,
      models: {
        model1: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
      resourcesPerJob: {
        typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });

    try {
      // Backend rejects, should throw and release job type slot
      await expect(
        limiter.queueJob({
          jobId: 'rejected-job',
          jobType: 'typeA',
          job: createSimpleTestJob(),
        })
      ).rejects.toThrow('All models rejected by backend');

      // Job type slot should be released
      const stats = limiter.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Multiple Sequential Jobs', () => {
  it('should correctly track state across multiple sequential jobs', async () => {
    const limiter = createTestLimiter({
      capacity: FIVE,
      jobTypes: { typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } },
    });

    try {
      // Run several jobs sequentially
      for (let i = ZERO; i < TEN; i++) {
        const jobType = i % 2 === ZERO ? 'typeA' : 'typeB';
        await limiter.queueJob({
          jobId: `seq-job-${i}`,
          jobType,
          job: createSimpleTestJob(),
        });

        // After each job, all slots should be released
        const stats = limiter.getJobTypeStats();
        expect(stats?.jobTypes.typeA?.inFlight).toBe(ZERO);
        expect(stats?.jobTypes.typeB?.inFlight).toBe(ZERO);
      }
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Integration - Delayed Error', () => {
  it('should release slot when job throws after delay', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      await expect(
        limiter.queueJob({
          jobId: 'delayed-error-job',
          jobType: 'typeA',
          job: createDelayedThrowingJob(SHORT_DELAY_MS, 'Delayed error'),
        })
      ).rejects.toThrow('Delayed error');

      const stats = limiter.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});
