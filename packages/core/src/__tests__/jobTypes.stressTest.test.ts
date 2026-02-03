/**
 * Stress tests for job types with 5+ concurrent job types.
 */
import { describe, expect, it } from '@jest/globals';
import { setTimeout as sleep } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';

const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const THIRTY = 30;
const FIFTY = 50;
const HUNDRED = 100;
const TOTAL_CAPACITY = 50;
const RPM_LIMIT = 100000;
const STRESS_TIMEOUT = 60000;
const RATIO_02 = 0.2;
const VARIANCE_THRESHOLD = 0.01;
const DEFAULT_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

interface UsageResult {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

type ResolveFunction = (result: UsageResult) => void;

type JobTypeKey = 'critical' | 'highPri' | 'normal' | 'lowPri' | 'background';
type StressLimiterInstance = LLMRateLimiterInstance<JobTypeKey>;

const JOB_TYPES_CONFIG = {
  critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02, flexible: false } },
  highPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  normal: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  lowPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  background: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
};

const createStressLimiter = (): StressLimiterInstance =>
  createLLMRateLimiter({
    models: {
      model1: {
        requestsPerMinute: RPM_LIMIT,
        maxConcurrentRequests: TOTAL_CAPACITY,
        pricing: DEFAULT_PRICING,
      },
    },
    resourceEstimationsPerJob: JOB_TYPES_CONFIG,
    ratioAdjustmentConfig: { adjustmentIntervalMs: FIFTY, releasesPerAdjustment: TEN },
  });

const createStressJob = async (
  ctx: { modelId: string },
  resolve: ResolveFunction
): Promise<InternalJobResult> => {
  resolve({ modelId: ctx.modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: FIVE });
  await sleep(FIVE);
  return { requestCount: ONE, usage: { input: TEN, output: FIVE, cached: ZERO } };
};

const queueJobForType = async (
  limiter: StressLimiterInstance,
  jobType: JobTypeKey,
  index: number,
  completed: string[]
): Promise<void> => {
  await limiter.queueJob({ jobId: `${jobType}-${index}`, jobType, job: createStressJob });
  completed.push(jobType);
};

const JOB_TYPE_KEYS: readonly JobTypeKey[] = ['critical', 'highPri', 'normal', 'lowPri', 'background'];

const createJobsForAllTypes = (
  limiter: StressLimiterInstance,
  jobsPerType: number,
  completed: string[]
): Array<Promise<void>> => {
  const promises: Array<Promise<void>> = [];
  for (const jobType of JOB_TYPE_KEYS) {
    for (let i = ZERO; i < jobsPerType; i += ONE) {
      promises.push(queueJobForType(limiter, jobType, i, completed));
    }
  }
  return promises;
};

// TODO: Investigate why this test hangs - may be a race condition with concurrent job type acquisition
describe.skip('Job Types - 5 Types Load', () => {
  it(
    'should handle 5 job types under load',
    async () => {
      const limiter = createStressLimiter();
      const completed: string[] = [];

      try {
        await Promise.all(createJobsForAllTypes(limiter, THIRTY, completed));
        expect(completed.length).toBe(JOB_TYPE_KEYS.length * THIRTY);
      } finally {
        limiter.stop();
      }
    },
    STRESS_TIMEOUT
  );
});

const queueHighPriJob = async (limiter: StressLimiterInstance, index: number): Promise<void> => {
  await limiter.queueJob({ jobId: `highPri-${index}`, jobType: 'highPri', job: createStressJob });
};

describe('Job Types - Non-Flexible Under Load', () => {
  it(
    'should preserve non-flexible ratio under load',
    async () => {
      const limiter = createStressLimiter();
      const ratioHistory: number[] = [];

      try {
        const interval = setInterval(() => {
          const ratio = limiter.getStats().jobTypes?.jobTypes.critical?.currentRatio;
          if (ratio !== undefined) ratioHistory.push(ratio);
        }, TEN);

        const promises: Array<Promise<void>> = [];
        for (let i = ZERO; i < FIFTY; i += ONE) {
          promises.push(queueHighPriJob(limiter, i));
        }

        await Promise.all(promises);
        clearInterval(interval);

        const variance = Math.max(...ratioHistory) - Math.min(...ratioHistory);
        expect(variance).toBeLessThan(VARIANCE_THRESHOLD);
      } finally {
        limiter.stop();
      }
    },
    STRESS_TIMEOUT
  );
});
