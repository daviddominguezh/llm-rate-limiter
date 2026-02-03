/**
 * Concurrent job type tests - verifies that job type limits are never exceeded.
 */
import { describe, expect, it } from '@jest/globals';
import { setTimeout as sleep } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const HUNDRED = 100;
const RPM_LIMIT = 10000;
const JOB_DELAY_MS = 5;
const RATIO_05 = 0.5;
const RATIO_03 = 0.3;
const RATIO_02 = 0.2;
const DEFAULT_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

interface JobTypeTracker {
  inFlight: Map<string, number>;
  peakInFlight: Map<string, number>;
  completed: Map<string, number>;
}

interface UsageResult {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

type ResolveFunction = (result: UsageResult) => void;

const createTracker = (): JobTypeTracker => ({
  inFlight: new Map(),
  peakInFlight: new Map(),
  completed: new Map(),
});

const trackStart = (tracker: JobTypeTracker, jobType: string): void => {
  const current = (tracker.inFlight.get(jobType) ?? ZERO) + ONE;
  tracker.inFlight.set(jobType, current);
  tracker.peakInFlight.set(jobType, Math.max(tracker.peakInFlight.get(jobType) ?? ZERO, current));
};

const trackEnd = (tracker: JobTypeTracker, jobType: string): void => {
  tracker.inFlight.set(jobType, (tracker.inFlight.get(jobType) ?? ONE) - ONE);
  tracker.completed.set(jobType, (tracker.completed.get(jobType) ?? ZERO) + ONE);
};

const createLimiter = (
  capacity: number,
  resourceEstimationsPerJob: Record<string, { estimatedUsedTokens: number; ratio?: { initialValue: number } }>
): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    models: {
      model1: {
        requestsPerMinute: RPM_LIMIT,
        maxConcurrentRequests: capacity,
        pricing: DEFAULT_PRICING,
      },
    },
    resourceEstimationsPerJob,
  }) as LLMRateLimiterInstance;

type JobFn = (
  ctx: { modelId: string },
  resolve: ResolveFunction
) => InternalJobResult | Promise<InternalJobResult>;

const createJob =
  (tracker: JobTypeTracker, jobType: string): JobFn =>
  async (ctx: { modelId: string }, resolve: ResolveFunction): Promise<InternalJobResult> => {
    trackStart(tracker, jobType);
    resolve({ modelId: ctx.modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: FIVE });
    await sleep(JOB_DELAY_MS);
    trackEnd(tracker, jobType);
    return { requestCount: ONE, usage: { input: TEN, output: FIVE, cached: ZERO } };
  };

describe('Job Types - Single Type Limits', () => {
  it('should never exceed allocated slots for a single job type', async () => {
    const tracker = createTracker();
    const limiter = createLimiter(TEN, {
      jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
    });

    try {
      const promises = Array.from(
        { length: TWENTY },
        async (_, i) =>
          await limiter.queueJob({ jobId: `jobA-${i}`, jobType: 'jobA', job: createJob(tracker, 'jobA') })
      );
      await Promise.all(promises);
      expect(tracker.peakInFlight.get('jobA')).toBeLessThanOrEqual(TEN);
      expect(tracker.completed.get('jobA')).toBe(TWENTY);
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types - Multiple Type Limits', () => {
  it('should never exceed allocated slots for multiple job types', async () => {
    const tracker = createTracker();
    const limiter = createLimiter(TEN, {
      jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      jobB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
    });

    try {
      const jobAPromises = Array.from(
        { length: TWENTY },
        async (_, i) =>
          await limiter.queueJob({ jobId: `jobA-${i}`, jobType: 'jobA', job: createJob(tracker, 'jobA') })
      );
      const jobBPromises = Array.from(
        { length: TWENTY },
        async (_, i) =>
          await limiter.queueJob({ jobId: `jobB-${i}`, jobType: 'jobB', job: createJob(tracker, 'jobB') })
      );
      await Promise.all([...jobAPromises, ...jobBPromises]);

      expect(tracker.peakInFlight.get('jobA')).toBeLessThanOrEqual(FIVE);
      expect(tracker.peakInFlight.get('jobB')).toBeLessThanOrEqual(FIVE);
    } finally {
      limiter.stop();
    }
  });
});

interface JobPromisesOptions {
  limiter: LLMRateLimiterInstance;
  tracker: JobTypeTracker;
  jobType: string;
  prefix: string;
  count: number;
}

const createJobPromises = (opts: JobPromisesOptions): Array<Promise<unknown>> =>
  Array.from(
    { length: opts.count },
    async (_, i) =>
      await opts.limiter.queueJob({
        jobId: `${opts.prefix}-${i}`,
        jobType: opts.jobType,
        job: createJob(opts.tracker, opts.jobType),
      })
  );

describe('Job Types - Different Ratios', () => {
  it('should respect different ratios for job types', async () => {
    const tracker = createTracker();
    const limiter = createLimiter(TEN, {
      highPriority: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      mediumPriority: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
      lowPriority: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
    });

    try {
      const high = createJobPromises({
        limiter,
        tracker,
        jobType: 'highPriority',
        prefix: 'high',
        count: TEN,
      });
      const med = createJobPromises({
        limiter,
        tracker,
        jobType: 'mediumPriority',
        prefix: 'med',
        count: TEN,
      });
      const low = createJobPromises({ limiter, tracker, jobType: 'lowPriority', prefix: 'low', count: TEN });
      await Promise.all([...high, ...med, ...low]);

      expect(tracker.peakInFlight.get('highPriority')).toBeLessThanOrEqual(FIVE);
      expect(tracker.peakInFlight.get('mediumPriority')).toBeLessThanOrEqual(THREE);
      expect(tracker.peakInFlight.get('lowPriority')).toBeLessThanOrEqual(TWO);
    } finally {
      limiter.stop();
    }
  });
});
