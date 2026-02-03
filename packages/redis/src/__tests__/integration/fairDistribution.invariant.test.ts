/**
 * Fair distribution capacity invariant tests with real Redis backend.
 * Mirrors core fairDistribution.invariant.test.ts but uses Redis.
 * These are CRITICAL tests that verify the system NEVER exceeds capacity.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';

import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import {
  assertCapacityInvariant,
  createAndStartLimiter,
  sleep,
  startControllableJobs,
} from './redisTestHelpers.js';
import {
  checkRedisAvailable,
  cleanupTestKeys,
  createTestState,
  setupAfterAll,
  setupBeforeAll,
} from './testSetup.js';

const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const FIFTY = 50;

/** Default job type for tests */
const DEFAULT_JOB_TYPE = 'test-job';

const DEFAULT_TIMEOUT = 60_000;

const state = createTestState();
const backends: RedisBackendInstance[] = [];

/** Create a test backend with unique prefix */
const createBackend = (capacity: number): RedisBackendInstance => {
  if (state.redis === undefined) {
    throw new Error('Redis not available');
  }
  const backend = createRedisBackend({
    redis: state.redis,
    totalCapacity: capacity,
    keyPrefix: state.testPrefix,
  });
  backends.push(backend);
  return backend;
};

beforeAll(async () => {
  await setupBeforeAll(state);
});

afterAll(async () => {
  await Promise.all(
    backends.map(async (backend) => {
      await backend.stop();
    })
  );
  await setupAfterAll(state);
});

beforeEach(async () => {
  if (!state.redisAvailable || state.redis === undefined) return;
  const prefix = `test-fair-inv-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
  state.testPrefix = prefix;
  await cleanupTestKeys(state.redis, prefix);
  backends.length = ZERO;
});

afterEach(async () => {
  const toStop = [...backends];
  backends.length = ZERO;
  await Promise.all(
    toStop.map(async (backend) => {
      await backend.stop();
    })
  );
  if (state.redis !== undefined) {
    await cleanupTestKeys(state.redis, state.testPrefix);
  }
});

/** Helper to create multiple limiters using reduce for sequential creation */
const createMultipleLimiters = async (
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

/** Helper to queue jobs for all limiters */
const queueJobsForAllLimiters = (
  limiters: LLMRateLimiterInstance[],
  jobsPerLimiter: number
): Array<Promise<unknown>> => {
  const allJobPromises: Array<Promise<unknown>> = [];
  for (const limiter of limiters) {
    for (let j = ZERO; j < jobsPerLimiter; j += ONE) {
      const promise = limiter
        .queueJob({
          jobId: `job-${limiter.getInstanceId()}-${j}`,
          jobType: DEFAULT_JOB_TYPE,
          job: async ({ modelId }, resolve) => {
            await sleep(FIVE);
            resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
          },
        })
        .catch(() => {
          /* Expected for jobs that get rejected */
        });
      allJobPromises.push(promise);
    }
  }
  return allJobPromises;
};

/** Helper to stop all limiters */
const stopAllLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  limiters.forEach((limiter) => {
    limiter.stop();
  });
};

/** Helper interface for job completion iteration */
interface JobCompletionContext {
  jobsA: Array<{ complete: () => void }>;
  jobsB: Array<{ complete: () => void }>;
  backend: RedisBackendInstance;
  capacity: number;
}

/** Process a single iteration of job completion with invariant check */
const processJobCompletionIteration = async (ctx: JobCompletionContext, index: number): Promise<void> => {
  const { jobsA, jobsB, backend, capacity } = ctx;
  const { [index]: jobA } = jobsA;
  const { [index]: jobB } = jobsB;
  if (jobA !== undefined) {
    jobA.complete();
  }
  await sleep(TEN);
  const statsAfterA = await backend.getStats();
  assertCapacityInvariant(statsAfterA, capacity);
  if (jobB !== undefined) {
    jobB.complete();
  }
  await sleep(TEN);
  const statsAfterB = await backend.getStats();
  assertCapacityInvariant(statsAfterB, capacity);
};

/** Run job completions sequentially with invariant checks */
const runJobCompletionsWithInvariantChecks = async (ctx: JobCompletionContext): Promise<void> => {
  const indices = Array.from({ length: TEN }, (_, i) => i);
  await indices.reduce<Promise<void>>(async (prevPromise, index) => {
    await prevPromise;
    await processJobCompletionIteration(ctx, index);
  }, Promise.resolve());
};

describe('Redis fair distribution - capacity invariant concurrent', () => {
  it(
    'NEVER exceeds capacity under concurrent load',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = FIFTY;
      const NUM_INSTANCES = FIVE;
      const JOBS_PER_INSTANCE = TWENTY;
      const backend = createBackend(CAPACITY);
      const limiters = await createMultipleLimiters(backend, NUM_INSTANCES);
      const allJobPromises = queueJobsForAllLimiters(limiters, JOBS_PER_INSTANCE);
      const statsDuring = await backend.getStats();
      assertCapacityInvariant(statsDuring, CAPACITY);
      await Promise.allSettled(allJobPromises);
      const statsAfter = await backend.getStats();
      assertCapacityInvariant(statsAfter, CAPACITY);
      stopAllLimiters(limiters);
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis fair distribution - capacity invariant rapid', () => {
  it(
    'maintains invariant through rapid job completion',
    async () => {
      const available = await checkRedisAvailable();
      if (!available) return;
      const CAPACITY = TWENTY;
      const backend = createBackend(CAPACITY);
      const limiterA = await createAndStartLimiter(backend);
      const limiterB = await createAndStartLimiter(backend);
      const jobsA = await startControllableJobs(limiterA, TEN);
      const statsAfterA = await backend.getStats();
      assertCapacityInvariant(statsAfterA, CAPACITY);
      const jobsB = await startControllableJobs(limiterB, TEN);
      const statsAfterB = await backend.getStats();
      assertCapacityInvariant(statsAfterB, CAPACITY);
      await runJobCompletionsWithInvariantChecks({ jobsA, jobsB, backend, capacity: CAPACITY });
      await Promise.allSettled(
        [...jobsA, ...jobsB].map(async (j) => {
          await j.promise;
        })
      );
      const statsFinal = await backend.getStats();
      assertCapacityInvariant(statsFinal, CAPACITY);
      limiterA.stop();
      limiterB.stop();
    },
    DEFAULT_TIMEOUT
  );
});
