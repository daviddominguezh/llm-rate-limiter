/**
 * Error handling tests for job types.
 * Verifies that slots are correctly released in all error scenarios.
 */
import { describe, expect, it } from '@jest/globals';

import {
  FIVE,
  ONE,
  SHORT_DELAY_MS,
  TEN,
  ZERO,
  createDelayedThrowingJob,
  createRejectingJob,
  createTestLimiter,
  createTestManager,
  createThrowingJob,
} from './jobTypes.helpers.js';

describe('Job Types Error Handling - Synchronous Throw', () => {
  it('should release slot when job throws synchronously', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      const statsBefore = limiter.getJobTypeStats();
      expect(statsBefore?.jobTypes.typeA?.inFlight).toBe(ZERO);

      await expect(
        limiter.queueJob({
          jobId: 'sync-throw-job',
          jobType: 'typeA',
          job: createThrowingJob('Synchronous error'),
        })
      ).rejects.toThrow('Synchronous error');

      // Slot should be released after synchronous throw
      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Error Handling - Asynchronous Rejection', () => {
  it('should release slot when job rejects asynchronously', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      await expect(
        limiter.queueJob({
          jobId: 'async-reject-job',
          jobType: 'typeA',
          job: createRejectingJob('Async rejection error'),
        })
      ).rejects.toThrow('Async rejection error');

      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Error Handling - Delayed Throw', () => {
  it('should release slot when job throws after delay', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      await expect(
        limiter.queueJob({
          jobId: 'delayed-throw-job',
          jobType: 'typeA',
          job: createDelayedThrowingJob(SHORT_DELAY_MS, 'Delayed error'),
        })
      ).rejects.toThrow('Delayed error');

      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Error Handling - Double Release', () => {
  it('should handle double release gracefully without negative inFlight', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Acquire a slot
      expect(manager.acquire('typeA')).toBe(true);
      expect(manager.getState('typeA')?.inFlight).toBe(ONE);

      // Release once - should succeed
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Release again - should not go negative
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Multiple extra releases - still should stay at zero
      manager.release('typeA');
      manager.release('typeA');
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Error Handling - Release Without Acquire', () => {
  it('should handle release without prior acquire', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Initial state should be zero
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Release without any prior acquire - should not error or go negative
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Multiple releases without acquire
      for (let i = ZERO; i < FIVE; i += ONE) {
        manager.release('typeA');
      }
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // After all those releases, acquire should still work normally
      expect(manager.acquire('typeA')).toBe(true);
      expect(manager.getState('typeA')?.inFlight).toBe(ONE);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Error Handling - Unknown Job Type', () => {
  it('should reject unknown job type through queueJob', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      // Queue job with job type that is not configured
      // The limiter should validate and reject unknown job types
      await expect(
        limiter.queueJob({
          jobId: 'unknown-type-job',
          jobType: 'unknownType',
          job: (ctx, resolve) => {
            resolve({ modelId: ctx.modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: FIVE });
            return { requestCount: ONE, usage: { input: TEN, output: FIVE, cached: ZERO } };
          },
        })
      ).rejects.toThrow("Unknown job type 'unknownType'");

      // Verify no slot was acquired for the unknown type
      const stats = limiter.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});
