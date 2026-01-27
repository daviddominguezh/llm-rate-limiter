import {
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
import type { LLMJobResult } from './limiterCombinations.helpers.js';

const FIVE = 5;
const SIX = 6;

describe('EdgeCase - concurrent jobs with all limiters', () => {
  it('should handle multiple concurrent jobs with all limiters', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: ESTIMATED_MEMORY_KB * TEN,
      models: {
        default: {
          maxConcurrentRequests: THREE,
          requestsPerMinute: TEN,
          requestsPerDay: HUNDRED,
          tokensPerMinute: MOCK_TOTAL_TOKENS * TEN,
          tokensPerDay: MOCK_TOTAL_TOKENS * HUNDRED,
          resourcesPerEvent: {
            estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
            estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
            estimatedUsedTokens: MOCK_TOTAL_TOKENS,
          },
          pricing: ZERO_PRICING,
        },
      },
    });
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < FIVE; i += ONE) {
      jobs.push(
        limiter.queueJob({
          jobId: generateJobId(),
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

describe('EdgeCase - concurrent jobs with concurrency limit', () => {
  it('should correctly limit concurrency with time limiters', async () => {
    const MAX_CONCURRENT = 2;
    const SHORT_DELAY = 30;
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          maxConcurrentRequests: MAX_CONCURRENT, requestsPerMinute: HUNDRED, tokensPerMinute: MOCK_TOTAL_TOKENS * HUNDRED,
          resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
          pricing: ZERO_PRICING,
        },
      },
    });
    const concurrencyTracker = { current: ZERO, max: ZERO };
    interface UsageType { modelId: string; inputTokens: number; outputTokens: number; cachedTokens: number }
    const createConcurrencyJob = (): { jobId: string; job: (args: { modelId: string }, resolve: (u: UsageType) => void) => Promise<LLMJobResult> } => ({
      jobId: generateJobId(),
      job: async ({ modelId }, resolve) => {
        concurrencyTracker.current += ONE;
        concurrencyTracker.max = Math.max(concurrencyTracker.max, concurrencyTracker.current);
        await setTimeoutAsync(SHORT_DELAY);
        concurrencyTracker.current -= ONE;
        resolve(createMockUsage(modelId));
        return createMockJobResult('concurrent-job');
      },
    });
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < SIX; i += ONE) { jobs.push(limiter.queueJob(createConcurrencyJob())); }
    await Promise.all(jobs);
    expect(concurrencyTracker.max).toBe(MAX_CONCURRENT);
    limiter.stop();
  });
});

describe('EdgeCase - memory + rpm combination', () => {
  it('should handle memory + rpm combination correctly', async () => {
    const MEMORY_CAPACITY = ESTIMATED_MEMORY_KB * TWO;
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_CAPACITY,
      models: {
        default: {
          requestsPerMinute: THREE,
          resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
          pricing: ZERO_PRICING,
        },
      },
    });
    interface SlowJobUsage { modelId: string; inputTokens: number; outputTokens: number; cachedTokens: number }
    const createSlowJob = (name: string): { jobId: string; job: (args: { modelId: string }, resolve: (u: SlowJobUsage) => void) => Promise<LLMJobResult> } => ({ jobId: generateJobId(), job: async ({ modelId }, resolve) => { await setTimeoutAsync(LONG_JOB_DELAY_MS); resolve(createMockUsage(modelId)); return createMockJobResult(name); } });
    const job1 = limiter.queueJob(createSlowJob('slow-1'));
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getModelStats('default').memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    const job2 = limiter.queueJob(createSlowJob('slow-2'));
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
          resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
          pricing: ZERO_PRICING,
        },
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
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
