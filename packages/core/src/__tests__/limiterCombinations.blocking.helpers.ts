/**
 * Helpers for blocking tests in limiter combinations tests.
 */
import {
  DEFAULT_JOB_TYPE,
  ESTIMATED_MEMORY_KB,
  LONG_JOB_DELAY_MS,
  ONE,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  ZERO,
  buildConfigWithBlockingLimiter,
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  getBlockingReason,
  setTimeoutAsync,
} from './limiterCombinations.helpers.js';
import type { LLMRateLimiterInstance, LimiterType } from './limiterCombinations.helpers.js';

const getDefaultModelStats = (
  limiter: LLMRateLimiterInstance
): ReturnType<LLMRateLimiterInstance['getModelStats']> => limiter.getModelStats('default');

/** Helper function to run blocking test for semaphore-based limiters */
export const testSemaphoreBlocker = async (
  limiters: LimiterType[],
  blocker: LimiterType,
  setLimiter: (l: LLMRateLimiterInstance) => void
): Promise<void> => {
  const config = buildConfigWithBlockingLimiter(limiters, blocker);
  const newLimiter = createLLMRateLimiter(config);
  setLimiter(newLimiter);
  expect(newLimiter.hasCapacity()).toBe(true);
  const slowJobPromise = newLimiter.queueJob({
    jobId: generateJobId(),
    jobType: DEFAULT_JOB_TYPE,
    job: async ({ modelId }, resolve) => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      resolve(createMockUsage(modelId));
      return createMockJobResult('slow-job');
    },
  });
  await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
  const stats = getDefaultModelStats(newLimiter);
  if (blocker === 'memory') {
    expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    expect(stats.memory?.availableKB).toBe(ZERO);
  } else if (blocker === 'concurrency') {
    expect(stats.concurrency?.active).toBe(ONE);
    expect(stats.concurrency?.available).toBe(ZERO);
  }
  expect(newLimiter.hasCapacity()).toBe(false);
  expect(getBlockingReason(newLimiter, limiters)).toBe(blocker);
  await slowJobPromise;
};

/** Helper function to run blocking test for time-window limiters */
export const testTimeWindowBlocker = async (
  limiters: LimiterType[],
  blocker: LimiterType,
  setLimiter: (l: LLMRateLimiterInstance) => void
): Promise<void> => {
  const config = buildConfigWithBlockingLimiter(limiters, blocker);
  const newLimiter = createLLMRateLimiter(config);
  setLimiter(newLimiter);
  expect(newLimiter.hasCapacity()).toBe(true);
  await newLimiter.queueJob({
    jobId: generateJobId(),
    jobType: DEFAULT_JOB_TYPE,
    job: ({ modelId }, resolve) => {
      resolve(createMockUsage(modelId));
      return createMockJobResult('exhaust-job');
    },
  });
  expect(newLimiter.hasCapacity()).toBe(false);
  expect(getBlockingReason(newLimiter, limiters)).toBe(blocker);
};
