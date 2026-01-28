/**
 * Helper utilities for fair distribution tests.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { FairDistributionBackend } from './fairDistribution.helpers.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const THOUSAND = 1000;

/** Default model config for tests */
export const createModelConfig = (estimatedTokens: number = TEN): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: estimatedTokens },
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
    onAvailableSlotsChange: onAvailableSlotsChange === undefined
      ? undefined
      : (avail) => { onAvailableSlotsChange(avail.slots); },
  });
  await limiter.start();
  return limiter;
};

/** Controllable job that can be completed externally */
export interface ControllableJob {
  complete: () => void;
  promise: Promise<unknown>;
}

/** Re-export sleep for tests */
export { sleep };

/** Create a deferred promise that can be resolved externally */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/** Deferred promise factory - wraps Promise constructor for lint compliance */
const createDeferred = (): Deferred => {
  let resolveRef: () => void = () => { /* placeholder */ };
  // eslint-disable-next-line promise/avoid-new -- Required for controllable job pattern
  const promise = new Promise<void>((resolve) => { resolveRef = resolve; });
  return { promise, resolve: resolveRef };
};

/** Start jobs that can be completed externally */
export const startControllableJobs = async (
  limiter: LLMRateLimiterInstance,
  count: number
): Promise<ControllableJob[]> => {
  const jobs: ControllableJob[] = [];
  for (let i = ZERO; i < count; i += ONE) {
    const deferred = createDeferred();

    const queuePromise = limiter.queueJob({
      jobId: `job-${i}`,
      job: async ({ modelId }, resolve) => {
        await deferred.promise;
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    }).catch(() => { /* Expected for jobs that get rejected */ });

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
  await Promise.allSettled(jobs.map(async (j) => { await awaitPromise(j.promise); }));
  // Allow releases to process
  await sleep(TEN);
};
