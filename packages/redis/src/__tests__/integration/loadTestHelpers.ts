/**
 * Shared utilities for Redis load testing (extreme and realistic load tests).
 * Contains trackers, job firing utilities, and limiter management.
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '@llm-rate-limiter/core';
import { setTimeout as sleep } from 'node:timers/promises';

import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import { assertCapacityInvariant } from './redisTestHelpers.js';
import type { TestState } from './testSetup.js';

const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const THOUSAND = 1000;

/** Simple job tracker for counting completions and failures */
export interface JobTracker {
  completed: number;
  failed: number;
  trackComplete: () => void;
  trackFailed: () => void;
}

/** Extended tracker with job duration tracking */
export interface TestTracker extends JobTracker {
  jobDurations: number[];
  trackJobDuration: (ms: number) => void;
}

/** Create a simple job tracker */
export const createJobTracker = (): JobTracker => {
  const tracker: JobTracker = {
    completed: ZERO,
    failed: ZERO,
    trackComplete: () => {
      tracker.completed += ONE;
    },
    trackFailed: () => {
      tracker.failed += ONE;
    },
  };
  return tracker;
};

/** Create a tracker with job duration tracking */
export const createTestTracker = (): TestTracker => {
  const tracker: TestTracker = {
    completed: ZERO,
    failed: ZERO,
    jobDurations: [],
    trackComplete: () => {
      tracker.completed += ONE;
    },
    trackFailed: () => {
      tracker.failed += ONE;
    },
    trackJobDuration: (ms: number) => {
      tracker.jobDurations.push(ms);
    },
  };
  return tracker;
};

/** Create model configuration for tests */
export const createModelConfig = (_estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Generate random integer in range [min, max] */
export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + ONE)) + min;

/** Calculate average of number array */
export const calculateAverage = (arr: number[]): number => {
  if (arr.length === ZERO) return ZERO;
  let sum = ZERO;
  for (const val of arr) {
    sum += val;
  }
  return Math.round(sum / arr.length);
};

/** Backend manager for tracking and cleaning up backends */
export class BackendManager {
  private backends: RedisBackendInstance[] = [];
  private readonly state: TestState;

  constructor(state: TestState) {
    this.state = state;
  }

  createBackend(capacity: number): RedisBackendInstance {
    if (this.state.redis === undefined) {
      throw new Error('Redis not available');
    }
    const backend = createRedisBackend({
      redis: this.state.redis,
      totalCapacity: capacity,
      keyPrefix: this.state.testPrefix,
    });
    this.backends.push(backend);
    return backend;
  }

  async stopAll(): Promise<void> {
    const toStop = [...this.backends];
    this.backends = [];
    await Promise.all(
      toStop.map(async (b) => {
        await b.stop();
      })
    );
  }

  clear(): void {
    this.backends = [];
  }
}

/** Create and start a limiter */
export const createAndStartLimiter = async (
  backend: RedisBackendInstance
): Promise<LLMRateLimiterInstance> => {
  const limiter = createLLMRateLimiter({
    backend: backend.getBackendConfig(),
    models: { default: createModelConfig(TEN) },
  });
  await limiter.start();
  return limiter;
};

/** Create multiple limiters sequentially */
export const createMultipleLimiters = async (
  backend: RedisBackendInstance,
  count: number
): Promise<LLMRateLimiterInstance[]> => {
  const indices = Array.from({ length: count }, (_, i) => i);
  return await indices.reduce<Promise<LLMRateLimiterInstance[]>>(async (accPromise, _) => {
    const acc = await accPromise;
    const limiter = await createAndStartLimiter(backend);
    return [...acc, limiter];
  }, Promise.resolve([]));
};

/** Cleanup all limiters */
export const cleanupLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  limiters.forEach((l) => {
    l.stop();
  });
};

/** Job configuration for slow jobs */
export interface SlowJobConfig {
  minDurationMs: number;
  maxDurationMs: number;
}

/** Fire jobs with configurable delays */
export const fireJobsWithDelay = async (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  getDelay: () => number,
  tracker: JobTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const delay = getDelay();
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          job: async ({ modelId }, resolve) => {
            await sleep(delay);
            resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
          },
        })
        .then(() => {
          tracker.trackComplete();
        })
        .catch(() => {
          tracker.trackFailed();
        });
      allPromises.push(promise);
    }
  }
  await Promise.all(allPromises);
};

/** Fire slow jobs with duration tracking */
export const fireSlowJobsWithTracking = async (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  jobConfig: SlowJobConfig,
  tracker: TestTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          job: async ({ modelId }, resolve) => {
            const duration = randomInt(jobConfig.minDurationMs, jobConfig.maxDurationMs);
            tracker.trackJobDuration(duration);
            await sleep(duration);
            resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
          },
        })
        .then(() => {
          tracker.trackComplete();
        })
        .catch(() => {
          tracker.trackFailed();
        });
      allPromises.push(promise);
    }
  }
  await Promise.all(allPromises);
};

/** Options for sustained pressure test */
export interface SustainedPressureOptions {
  limiters: LLMRateLimiterInstance[];
  rounds: number;
  jobsPerInstance: number;
  backend: RedisBackendInstance;
  capacity: number;
  expectedTotal: number;
}

/** Run sustained pressure rounds with capacity invariant checks */
export const runSustainedPressureRounds = async (opts: SustainedPressureOptions): Promise<void> => {
  const { limiters, rounds, jobsPerInstance, backend, capacity, expectedTotal } = opts;
  const indices = Array.from({ length: rounds }, (_, i) => i);
  await indices.reduce<Promise<void>>(async (prevPromise, _) => {
    await prevPromise;
    const tracker = createJobTracker();
    await fireJobsWithDelay(limiters, jobsPerInstance, () => randomInt(FIVE, TEN), tracker);
    const stats = await backend.getStats();
    assertCapacityInvariant(stats, capacity);
    expect(tracker.completed + tracker.failed).toBe(expectedTotal);
  }, Promise.resolve());
};
