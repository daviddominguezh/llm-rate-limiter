/**
 * Helper utilities for fair distribution tests.
 */
import { EventEmitter, once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import type { FairDistributionBackend } from './fairDistribution.helpers.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const THOUSAND = 1000;
const DEFAULT_JOB_TYPE = 'default';

/** Default model config for tests */
export const createModelConfig = (_estimatedTokens: number = TEN): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Create and start a limiter with the V2 backend */
export const createAndStartLimiter = async (
  backend: FairDistributionBackend,
  onAvailableSlotsChange?: (slots: number) => void
): Promise<LLMRateLimiterInstance> => {
  const limiter = createLLMRateLimiter({
    backend: backend.getBackendConfig(),
    models: { default: createModelConfig() },
    resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE } },
    onAvailableSlotsChange:
      onAvailableSlotsChange === undefined
        ? undefined
        : (avail, _reason, _modelId) => {
            onAvailableSlotsChange(avail.slots);
          },
  });
  await limiter.start();
  return limiter as LLMRateLimiterInstance;
};

/** Controllable job that can be completed externally */
export interface ControllableJob {
  complete: () => void;
  promise: Promise<unknown>;
}

/** Re-export sleep for tests */
export { sleep };

/** Create a deferred promise that can be resolved externally using EventEmitter */
interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
}

/** Deferred promise factory using EventEmitter to avoid new Promise */
const createDeferred = (): Deferred => {
  const emitter = new EventEmitter();
  const promise = once(emitter, 'resolve');
  const resolve = (): void => {
    emitter.emit('resolve');
  };
  return { promise, resolve };
};

/** Start jobs that can be completed externally */
export const startControllableJobs = async (
  limiter: LLMRateLimiterInstance,
  count: number
): Promise<ControllableJob[]> => {
  const jobs: ControllableJob[] = [];
  for (let i = ZERO; i < count; i += ONE) {
    const deferred = createDeferred();

    const queuePromise = limiter
      .queueJob({
        jobId: `job-${i}`,
        jobType: DEFAULT_JOB_TYPE,
        job: async ({ modelId }, resolve) => {
          await deferred.promise;
          resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
          return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
        },
      })
      .catch(() => {
        /* Expected for jobs that get rejected */
      });

    jobs.push({ complete: deferred.resolve, promise: queuePromise });
  }
  // Allow acquires to process
  await sleep(TEN);
  return jobs;
};

/** Wait for a promise and return void */
const awaitPromise = async (p: Promise<unknown>): Promise<void> => {
  await p;
};

/** Complete specific jobs and wait for releases to process */
export const completeJobs = async (jobs: ControllableJob[]): Promise<void> => {
  for (const job of jobs) {
    job.complete();
  }
  // Wait for all promises to settle
  await Promise.allSettled(
    jobs.map(async (j) => {
      await awaitPromise(j.promise);
    })
  );
  // Allow releases to process
  await sleep(TEN);
};
