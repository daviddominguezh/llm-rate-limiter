/**
 * Helper utilities for Redis integration tests with fair distribution.
 * Mirrors the core fairDistribution.testHelpers.ts but uses the real Redis backend.
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '@llm-rate-limiter/core';
import { EventEmitter, once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

import type { RedisBackendInstance, RedisBackendStats, RedisInstanceStats } from '../../types.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const THOUSAND = 1000;

/** Default model config for tests */
export const createModelConfig = (_estimatedTokens: number = TEN): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Create and start a limiter with the Redis backend */
export const createAndStartLimiter = async (
  backend: RedisBackendInstance,
  onAvailableSlotsChange?: (slots: number) => void
): Promise<LLMRateLimiterInstance> => {
  const limiter = createLLMRateLimiter({
    backend: backend.getBackendConfig(),
    models: { default: createModelConfig() },
    onAvailableSlotsChange:
      onAvailableSlotsChange === undefined
        ? undefined
        : (avail) => {
            onAvailableSlotsChange(avail.slots);
          },
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

/** Deferred promise that can be resolved externally */
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
  // Allow acquires to process (longer for Redis network latency)
  await sleep(TEN * TEN);
  return jobs;
};

/** Complete specific jobs and wait for releases to process */
export const completeJobs = async (jobs: ControllableJob[]): Promise<void> => {
  for (const job of jobs) {
    job.complete();
  }
  await Promise.allSettled(
    jobs.map(async (j) => {
      await j.promise;
    })
  );
  // Allow releases to process (longer for Redis network latency)
  await sleep(TEN * TEN);
};

/** Get instance stats by ID from RedisBackendStats */
export const getInstanceStats = (
  stats: RedisBackendStats,
  instanceId: string
): RedisInstanceStats | undefined => stats.instances.find((inst) => inst.id === instanceId);

/** Assert that total in-flight + allocated never exceeds capacity */
export const assertCapacityInvariant = (stats: RedisBackendStats, totalCapacity: number): void => {
  const total = stats.totalInFlight + stats.totalAllocated;
  if (total > totalCapacity) {
    throw new Error(
      `Capacity invariant violated: inFlight(${stats.totalInFlight}) + allocated(${stats.totalAllocated}) = ${total} > capacity(${totalCapacity})`
    );
  }
};

/** Calculate total usage from instance stats array */
export const calculateTotalFromStats = (instances: RedisInstanceStats[]): number => {
  let total = ZERO;
  for (const inst of instances) {
    total += inst.inFlight + inst.allocation;
  }
  return total;
};
