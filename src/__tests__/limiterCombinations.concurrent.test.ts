import {
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  generateJobId,
  HUNDRED,
  LONG_JOB_DELAY_MS,
  MOCK_TOTAL_TOKENS,
  ONE,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  setTimeoutAsync,
  TEN,
  THREE,
  TWO,
  ZERO,
  ZERO_PRICING,
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
          resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
          pricing: ZERO_PRICING,
        },
      },
    });
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < FIVE; i += ONE) {
      jobs.push(limiter.queueJob({
        jobId: generateJobId(),
        job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult(`job-${String(i)}`); },
      }));
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
          maxConcurrentRequests: MAX_CONCURRENT,
          requestsPerMinute: HUNDRED,
          tokensPerMinute: MOCK_TOTAL_TOKENS * HUNDRED,
          resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT, estimatedUsedTokens: MOCK_TOTAL_TOKENS },
          pricing: ZERO_PRICING,
        },
      },
    });

    // Track concurrency outside the loop
    const concurrencyTracker = { current: ZERO, max: ZERO };

    // Create job options factory
    const createConcurrencyJob = (): { jobId: string; job: (args: { modelId: string }, resolve: (u: { modelId: string; inputTokens: number; outputTokens: number; cachedTokens: number }) => void) => Promise<LLMJobResult> } => ({
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

    // Create all jobs upfront
    const jobs: Array<Promise<LLMJobResult>> = [];
    for (let i = ZERO; i < SIX; i += ONE) {
      jobs.push(limiter.queueJob(createConcurrencyJob()));
    }

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
    const job1 = limiter.queueJob({
      jobId: generateJobId(),
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow-1');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.getModelStats('default').memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    const job2 = limiter.queueJob({
      jobId: generateJobId(),
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow-2');
      },
    });
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
      job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('job-1'); },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('job-2'); },
    });
    const stats = limiter.getModelStats('default');
    expect(stats.concurrency?.available).toBe(TWO);
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS * TWO);
    limiter.stop();
  });
});
