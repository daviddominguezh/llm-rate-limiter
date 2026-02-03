/**
 * Shared helpers for distributed extreme load tests.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import {
  type DistributedBackendInstance,
  type JobTracker,
  createConnectedLimiters,
  createDistributedBackend,
  createJobTracker,
} from './distributedBackend.helpers.js';

export {
  type DistributedBackendInstance,
  type JobTracker,
  createConnectedLimiters,
  createDistributedBackend,
  createJobTracker,
};

export const ZERO = 0;
export const ONE = 1;
export const DEFAULT_JOB_TYPE = 'default';
export const TWO = 2;
export const THREE = 3;
export const FIVE = 5;
export const TEN = 10;
export const TWENTY = 20;
export const FIFTY = 50;
export const HUNDRED = 100;
export const TWO_HUNDRED = 200;
export const FIVE_HUNDRED = 500;
export const THOUSAND = 1000;
export const TWO_THOUSAND = 2000;
export const FIVE_THOUSAND = 5000;
export const TEN_THOUSAND = 10000;
export const MS_PER_MINUTE = 60_000;
export const EXTREME_TEST_TIMEOUT = 60_000;

export type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;

export interface JobConfig {
  getTokens: () => number;
  getDelay: () => number;
}

export const createModelConfig = (_estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: TEN_THOUSAND,
  tokensPerMinute: TEN_THOUSAND * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

export const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) {
    unsubscribe();
    limiter.stop();
  }
};

export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + ONE)) + min;

export const fireSimultaneousJobs = async (
  instances: InstanceArray,
  jobsPerInstance: number,
  config: JobConfig,
  tracker: JobTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < instances.length; i += ONE) {
    const { limiter } = instances[i] ?? {};
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const tokens = config.getTokens();
      const delay = config.getDelay();
      const idx = i;
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          jobType: DEFAULT_JOB_TYPE,
          job: async ({ modelId }, resolve) => {
            await sleep(delay);
            resolve({ modelId, inputTokens: tokens, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: tokens, output: ZERO, cached: ZERO } };
          },
        })
        .then(() => {
          tracker.trackComplete(idx, tokens);
        })
        .catch((error: unknown) => {
          tracker.trackFailed(error);
        });
      allPromises.push(promise);
    }
  }
  await Promise.all(allPromises);
};

export const assertLimitsNeverExceeded = (
  stats: ReturnType<DistributedBackendInstance['getStats']>,
  tokensPerMinute: number,
  requestsPerMinute: number
): void => {
  expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(tokensPerMinute);
  expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(requestsPerMinute);
};

export const assertJobAccountingCorrect = (
  tracker: JobTracker,
  totalJobs: number,
  stats: ReturnType<DistributedBackendInstance['getStats']>
): void => {
  expect(tracker.completed + tracker.failed).toBe(totalJobs);
  expect(stats.totalAcquires).toBe(tracker.completed);
  expect(stats.totalReleases).toBe(tracker.completed);
  expect(stats.rejections).toBe(tracker.failed);
};

/** Create instances for a test */
export const createTestInstances = async (
  count: number,
  backend: DistributedBackendInstance,
  estimatedTokens: number
): Promise<InstanceArray> =>
  await createConnectedLimiters(
    count,
    backend,
    (b) =>
      createLLMRateLimiter({
        backend: b,
        models: { default: createModelConfig(estimatedTokens) },
        resourceEstimationsPerJob: {
          [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: estimatedTokens },
        },
      }) as LLMRateLimiterInstance
  );
