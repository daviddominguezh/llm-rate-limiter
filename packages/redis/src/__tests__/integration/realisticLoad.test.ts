/**
 * Redis realistic load tests - simulating real-world LLM API latencies.
 * Tests with 50-1000ms job durations typical of LLM calls.
 */
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  BackendManager,
  type TestTracker,
  calculateAverage,
  cleanupLimiters,
  createMultipleLimiters,
  createTestTracker,
  fireSlowJobsWithTracking,
  randomInt,
} from './loadTestHelpers.js';
import { assertCapacityInvariant } from './redisTestHelpers.js';
import {
  checkRedisAvailable,
  cleanupTestKeys,
  createTestState,
  setupAfterAll,
  setupBeforeAll,
} from './testSetup.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const THIRTY = 30;
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const THREE_HUNDRED = 300;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;
const RADIX_BASE = 36;
const RANDOM_SLICE_START = 2;
const SLOW_JOB_PROBABILITY = 0.3;
const REALISTIC_TEST_TIMEOUT = 180_000;

/** Default job type for tests */
const DEFAULT_JOB_TYPE = 'test-job';

const state = createTestState();
const backendManager = new BackendManager(state);

beforeAll(async () => {
  await setupBeforeAll(state);
});

afterAll(async () => {
  await backendManager.stopAll();
  await setupAfterAll(state);
});

beforeEach(async () => {
  if (!state.redisAvailable || state.redis === undefined) return;
  state.testPrefix = `test-realistic-${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
  await cleanupTestKeys(state.redis, state.testPrefix);
  backendManager.clear();
});

afterEach(async () => {
  await backendManager.stopAll();
  if (state.redis !== undefined) {
    await cleanupTestKeys(state.redis, state.testPrefix);
  }
});

/** Queue mixed fast and slow jobs */
const queueMixedJobs = (
  limiters: LLMRateLimiterInstance[],
  jobsPerInstance: number,
  tracker: TestTracker
): Array<Promise<void>> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < limiters.length; i += ONE) {
    const { [i]: limiter } = limiters;
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jobsPerInstance; j += ONE) {
      const isSlow = Math.random() < SLOW_JOB_PROBABILITY;
      const minMs = isSlow ? TWO_HUNDRED : TEN;
      const maxMs = isSlow ? FIVE_HUNDRED : FIFTY;
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          jobType: DEFAULT_JOB_TYPE,
          job: async ({ modelId }, resolve) => {
            const duration = randomInt(minMs, maxMs);
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
  return allPromises;
};

describe('Redis realistic load - basic latency 1', () => {
  it(
    'maintains capacity with 50-200ms jobs simulating fast LLM calls',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TWENTY);
      const limiters = await createMultipleLimiters(backend, THREE);
      const tracker = createTestTracker();
      await fireSlowJobsWithTracking(
        limiters,
        THIRTY,
        { minDurationMs: FIFTY, maxDurationMs: TWO_HUNDRED },
        tracker
      );
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, TWENTY);
      expect(tracker.completed + tracker.failed).toBe(THREE * THIRTY);
      expect(tracker.jobDurations.length).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('Redis realistic load - basic latency 2', () => {
  it(
    'maintains correctness with very slow jobs (500-1000ms)',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TEN);
      const limiters = await createMultipleLimiters(backend, TWO);
      const tracker = createTestTracker();
      await fireSlowJobsWithTracking(
        limiters,
        FIVE,
        { minDurationMs: FIVE_HUNDRED, maxDurationMs: THOUSAND },
        tracker
      );
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, TEN);
      expect(tracker.completed + tracker.failed).toBe(TWO * FIVE);
      expect(calculateAverage(tracker.jobDurations)).toBeGreaterThanOrEqual(FIVE_HUNDRED);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('Redis realistic load - mixed jobs', () => {
  it(
    'handles mixed fast and slow jobs',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TWENTY);
      const limiters = await createMultipleLimiters(backend, THREE);
      const tracker = createTestTracker();
      const allPromises = queueMixedJobs(limiters, TWENTY, tracker);
      await Promise.all(allPromises);
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, TWENTY);
      expect(tracker.completed + tracker.failed).toBe(THREE * TWENTY);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('Redis realistic load - sustained 1', () => {
  it(
    'maintains capacity under sustained slow job pressure',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(THIRTY);
      const limiters = await createMultipleLimiters(backend, FIVE);
      const tracker = createTestTracker();
      await fireSlowJobsWithTracking(
        limiters,
        FIFTY,
        { minDurationMs: HUNDRED, maxDurationMs: THREE_HUNDRED },
        tracker
      );
      const stats = await backend.getStats();
      assertCapacityInvariant(stats, THIRTY);
      expect(tracker.completed + tracker.failed).toBe(FIVE * FIFTY);
      expect(tracker.completed).toBeGreaterThan(ZERO);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('Redis realistic load - sustained 2', () => {
  it(
    'tracks job duration statistics accurately',
    async () => {
      if (!(await checkRedisAvailable())) return;
      const backend = backendManager.createBackend(TEN);
      const limiters = await createMultipleLimiters(backend, TWO);
      const tracker = createTestTracker();
      await fireSlowJobsWithTracking(
        limiters,
        TEN,
        { minDurationMs: HUNDRED, maxDurationMs: TWO_HUNDRED },
        tracker
      );
      const avgDuration = calculateAverage(tracker.jobDurations);
      expect(avgDuration).toBeGreaterThanOrEqual(HUNDRED);
      expect(avgDuration).toBeLessThanOrEqual(TWO_HUNDRED);
      cleanupLimiters(limiters);
    },
    REALISTIC_TEST_TIMEOUT
  );
});
