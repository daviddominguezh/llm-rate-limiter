import type { ConcurrencyTracker, LLMJobResult } from './limiterCombinations.helpers.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  HUNDRED,
  LONG_JOB_DELAY_MS,
  MOCK_TOTAL_TOKENS,
  ONE,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  TEN,
  THREE,
  TWO,
  ZERO,
  ZERO_PRICING,
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  setTimeoutAsync,
} from './limiterCombinations.helpers.js';

const FIVE = 5;
const SIX = 6;
const MAX_CONCURRENT = 2;
const SHORT_DELAY = 30;
const MEMORY_CAPACITY = ESTIMATED_MEMORY_KB * TWO;

const createSlowJob = (
  name: string
): {
  jobId: string;
  job: (
    args: { modelId: string },
    resolve: (u: ReturnType<typeof createMockUsage>) => void
  ) => Promise<LLMJobResult>;
} => ({
  jobId: generateJobId(),
  job: async ({ modelId }, resolve) => {
    await setTimeoutAsync(LONG_JOB_DELAY_MS);
    resolve(createMockUsage(modelId));
    return createMockJobResult(name);
  },
});

describe('EdgeCase - concurrent jobs with all limiters', () => {
  it('should handle multiple concurrent jobs with all limiters', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      models: {
        default: {
          maxCapacity: ESTIMATED_MEMORY_KB * TEN,
          maxConcurrentRequests: THREE,
          requestsPerMinute: TEN,
          requestsPerDay: HUNDRED,
          tokensPerMinute: MOCK_TOTAL_TOKENS * TEN,
          tokensPerDay: MOCK_TOTAL_TOKENS * HUNDRED,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: {
          estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      },
    });
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < FIVE; i += ONE) {
      jobs.push(
        limiter.queueJob({
          jobId: generateJobId(),
          jobType: DEFAULT_JOB_TYPE,
          job: ({ modelId }, resolve) => {
            resolve(createMockUsage(modelId));
            return createMockJobResult(`job-${String(i)}`);
          },
        })
      );
    }
    const results = await Promise.all(jobs);
    expect(results).toHaveLength(FIVE);
    expect(limiter.getModelStats('default').requestsPerMinute?.current).toBe(FIVE);
    limiter.stop();
  });
});

describe('EdgeCase - concurrency limit tracking', () => {
  it('should correctly limit concurrency with time limiters', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          maxConcurrentRequests: MAX_CONCURRENT,
          requestsPerMinute: HUNDRED,
          tokensPerMinute: MOCK_TOTAL_TOKENS * HUNDRED,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: {
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      },
    });
    const tracker: ConcurrencyTracker = { current: ZERO, max: ZERO };
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < SIX; i += ONE) {
      jobs.push(
        limiter.queueJob({
          jobId: generateJobId(),
          jobType: DEFAULT_JOB_TYPE,
          job: async ({ modelId }, resolve) => {
            tracker.current += ONE;
            tracker.max = Math.max(tracker.max, tracker.current);
            await setTimeoutAsync(SHORT_DELAY);
            tracker.current -= ONE;
            resolve(createMockUsage(modelId));
            return createMockJobResult('concurrent-job');
          },
        })
      );
    }
    await Promise.all(jobs);
    expect(tracker.max).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});

describe('EdgeCase - memory + rpm combination', () => {
  it('should handle memory + rpm combination correctly', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      models: {
        default: {
          maxCapacity: MEMORY_CAPACITY,
          requestsPerMinute: THREE,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: {
          estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
        },
      },
    });
    const job1 = limiter.queueJob({ ...createSlowJob('slow-1'), jobType: DEFAULT_JOB_TYPE });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getModelStats('default').memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    const job2 = limiter.queueJob({ ...createSlowJob('slow-2'), jobType: DEFAULT_JOB_TYPE });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getModelStats('default').memory?.availableKB).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await Promise.all([job1, job2]);
    limiter.stop();
  });
});

describe('EdgeCase - concurrency + tpm combination', () => {
  it('should handle concurrency + tpm combination correctly', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          maxConcurrentRequests: TWO,
          tokensPerMinute: MOCK_TOTAL_TOKENS * THREE,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-2');
      },
    });
    const stats = limiter.getModelStats('default');
    expect(stats.concurrency?.available).toBe(TWO);
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS * TWO);
    limiter.stop();
  });
});
