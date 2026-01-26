import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMJobResult, LLMRateLimiterInstance } from '../types.js';

const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
const ZERO_CACHED_TOKENS = 0;
const DEFAULT_REQUEST_COUNT = 1;
const ESTIMATED_MEMORY_KB = 10240; // 10MB in KB

const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): LLMJobResult => ({
  text,
  requestCount,
  usage: {
    input: MOCK_INPUT_TOKENS,
    output: MOCK_OUTPUT_TOKENS,
    cached: ZERO_CACHED_TOKENS,
  },
});

describe('LLMRateLimiter', () => {
  let limiter: LLMRateLimiterInstance;

  afterEach(() => {
    limiter?.stop();
  });

  describe('initialization', () => {
    it('should create limiter with no config', () => {
      limiter = createLLMRateLimiter({});
      expect(limiter).toBeDefined();
      expect(limiter.hasCapacity()).toBe(true);
    });

    it('should create limiter with memory config', () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });
      expect(limiter).toBeDefined();

      const stats = limiter.getStats();
      expect(stats.memory).toBeDefined();
      expect(stats.memory?.maxCapacityKB).toBeGreaterThan(0);
    });

    it('should create limiter with RPM config', () => {
      const RPM_LIMIT = 60;
      const ESTIMATED_REQUESTS = 1;
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
      });

      const stats = limiter.getStats();
      expect(stats.requestsPerMinute).toBeDefined();
      expect(stats.requestsPerMinute?.limit).toBe(RPM_LIMIT);
    });

    it('should create limiter with concurrency config', () => {
      const MAX_CONCURRENT = 5;
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      const stats = limiter.getStats();
      expect(stats.concurrency).toBeDefined();
      expect(stats.concurrency?.limit).toBe(MAX_CONCURRENT);
    });

    it('should create limiter with all configs', () => {
      const RPM_LIMIT = 60;
      const RPD_LIMIT = 1000;
      const TPM_LIMIT = 100000;
      const TPD_LIMIT = 1000000;
      const MAX_CONCURRENT = 5;

      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        requestsPerMinute: RPM_LIMIT,
        requestsPerDay: RPD_LIMIT,
        tokensPerMinute: TPM_LIMIT,
        tokensPerDay: TPD_LIMIT,
        maxConcurrentRequests: MAX_CONCURRENT,
        resourcesPerEvent: {
          estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      });

      const stats = limiter.getStats();
      expect(stats.memory).toBeDefined();
      expect(stats.concurrency).toBeDefined();
      expect(stats.requestsPerMinute).toBeDefined();
      expect(stats.requestsPerDay).toBeDefined();
      expect(stats.tokensPerMinute).toBeDefined();
      expect(stats.tokensPerDay).toBeDefined();
    });

    it('should throw error if tokensPerMinute is set without estimatedUsedTokens', () => {
      expect(() => {
        createLLMRateLimiter({
          tokensPerMinute: 10000,
        });
      }).toThrow('estimatedUsedTokens is required');
    });

    it('should throw error if tokensPerDay is set without estimatedUsedTokens', () => {
      expect(() => {
        createLLMRateLimiter({
          tokensPerDay: 100000,
        });
      }).toThrow('estimatedUsedTokens is required');
    });

    it('should throw error if requestsPerMinute is set without estimatedNumberOfRequests', () => {
      expect(() => {
        createLLMRateLimiter({
          requestsPerMinute: 60,
        });
      }).toThrow('estimatedNumberOfRequests is required');
    });

    it('should throw error if memory is set without estimatedUsedMemoryKB', () => {
      expect(() => {
        createLLMRateLimiter({
          memory: { freeMemoryRatio: 0.8 },
        });
      }).toThrow('estimatedUsedMemoryKB is required');
    });

    it('should call onLog when initialized', () => {
      const logMessages: string[] = [];
      limiter = createLLMRateLimiter({
        onLog: (message) => {
          logMessages.push(message);
        },
      });

      expect(logMessages.some((msg) => msg.includes('Initialized'))).toBe(true);
    });

    it('should use custom label in logs', () => {
      const CUSTOM_LABEL = 'CustomRateLimiter';
      const logMessages: string[] = [];
      limiter = createLLMRateLimiter({
        label: CUSTOM_LABEL,
        onLog: (message) => {
          logMessages.push(message);
        },
      });

      expect(logMessages.some((msg) => msg.includes(CUSTOM_LABEL))).toBe(true);
    });
  });

  describe('queueJob', () => {
    it('should execute job and return result', async () => {
      limiter = createLLMRateLimiter({});

      const result = await limiter.queueJob(() => createMockJobResult('test-result'));

      expect(result.text).toBe('test-result');
      expect(result.usage.input).toBe(MOCK_INPUT_TOKENS);
      expect(result.usage.output).toBe(MOCK_OUTPUT_TOKENS);
    });

    it('should execute async job', async () => {
      limiter = createLLMRateLimiter({});

      const result = await limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return createMockJobResult('async-result');
      });

      expect(result.text).toBe('async-result');
    });

    it('should track request count in RPM counter', async () => {
      const RPM_LIMIT = 60;
      const ESTIMATED_REQUESTS = 1;
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
      });

      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.current).toBe(2);
    });

    it('should track token usage in TPM counter', async () => {
      const TPM_LIMIT = 100000;
      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      await limiter.queueJob(() => createMockJobResult('job-1'));

      const stats = limiter.getStats();
      // After job: actual tokens are tracked (refund happens)
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    });

    it('should refund difference between estimated and actual tokens', async () => {
      const TPM_LIMIT = 100000;
      const ESTIMATED_TOKENS = 200; // Estimate higher than actual
      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
      });

      // Job returns actual usage of 150 tokens (100 input + 50 output)
      await limiter.queueJob(() => createMockJobResult('job-1'));

      const stats = limiter.getStats();
      // Should show actual tokens, not estimated (200 - (200-150) = 150)
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    });

    it('should refund difference between estimated and actual requests', async () => {
      const RPM_LIMIT = 60;
      const ESTIMATED_REQUESTS = 5; // Estimate higher than actual
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: ESTIMATED_REQUESTS },
      });

      // Job makes only 3 actual requests
      const ACTUAL_REQUESTS = 3;
      await limiter.queueJob(() => createMockJobResult('job-1', ACTUAL_REQUESTS));

      const stats = limiter.getStats();
      // Should show actual requests, not estimated (5 - (5-3) = 3)
      expect(stats.requestsPerMinute?.current).toBe(ACTUAL_REQUESTS);
    });

    it('should respect concurrency limit', async () => {
      const MAX_CONCURRENT = 2;
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      let concurrentCount = 0;
      let maxConcurrent = 0;
      const DELAY_MS = 50;

      const job = async (): Promise<LLMJobResult> => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((resolve) => {
          setTimeout(resolve, DELAY_MS);
        });
        concurrentCount--;
        return createMockJobResult('concurrent-job');
      };

      const JOB_COUNT = 5;
      await Promise.all(Array.from({ length: JOB_COUNT }, async () => await limiter.queueJob(job)));

      expect(maxConcurrent).toBe(MAX_CONCURRENT);
    });

    it('should handle job errors and release resources', async () => {
      const MAX_CONCURRENT = 2;
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      const failingJob = async (): Promise<LLMJobResult> => {
        throw new Error('Job failed');
      };

      await expect(limiter.queueJob(failingJob)).rejects.toThrow('Job failed');

      // Verify resources were released
      const stats = limiter.getStats();
      expect(stats.concurrency?.active).toBe(0);
      expect(stats.concurrency?.available).toBe(MAX_CONCURRENT);
    });
  });

  describe('hasCapacity', () => {
    it('should return true when all limits have capacity', () => {
      limiter = createLLMRateLimiter({
        requestsPerMinute: 60,
        maxConcurrentRequests: 5,
        resourcesPerEvent: { estimatedNumberOfRequests: 1 },
      });

      expect(limiter.hasCapacity()).toBe(true);
    });

    it('should return false when RPM limit reached', async () => {
      const RPM_LIMIT = 2;
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: 1 },
      });

      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      expect(limiter.hasCapacity()).toBe(false);
    });

    it('should return false when concurrency limit reached', async () => {
      const MAX_CONCURRENT = 1;
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      // Start a job but don't await it
      const LONG_DELAY = 1000;
      const jobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_DELAY);
        });
        return createMockJobResult('slow-job');
      });

      // Give it time to start
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      expect(limiter.hasCapacity()).toBe(false);

      // Clean up
      await jobPromise;
    });
  });

  describe('getStats', () => {
    it('should return empty stats for no config', () => {
      limiter = createLLMRateLimiter({});

      const stats = limiter.getStats();
      expect(stats.memory).toBeUndefined();
      expect(stats.concurrency).toBeUndefined();
      expect(stats.requestsPerMinute).toBeUndefined();
      expect(stats.requestsPerDay).toBeUndefined();
      expect(stats.tokensPerMinute).toBeUndefined();
      expect(stats.tokensPerDay).toBeUndefined();
    });

    it('should return correct memory stats', () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const stats = limiter.getStats();
      expect(stats.memory?.activeKB).toBe(0);
      expect(stats.memory?.maxCapacityKB).toBeGreaterThan(0);
      expect(stats.memory?.availableKB).toBe(stats.memory?.maxCapacityKB);
      expect(stats.memory?.systemAvailableKB).toBeGreaterThan(0);
    });

    it('should return correct concurrency stats', () => {
      const MAX_CONCURRENT = 5;
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      const stats = limiter.getStats();
      expect(stats.concurrency?.active).toBe(0);
      expect(stats.concurrency?.limit).toBe(MAX_CONCURRENT);
      expect(stats.concurrency?.available).toBe(MAX_CONCURRENT);
      expect(stats.concurrency?.waiting).toBe(0);
    });

    it('should return correct time-based stats', () => {
      const RPM_LIMIT = 60;
      const RPD_LIMIT = 1000;
      const TPM_LIMIT = 100000;
      const TPD_LIMIT = 1000000;

      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        requestsPerDay: RPD_LIMIT,
        tokensPerMinute: TPM_LIMIT,
        tokensPerDay: TPD_LIMIT,
        resourcesPerEvent: {
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      });

      const stats = limiter.getStats();

      expect(stats.requestsPerMinute?.limit).toBe(RPM_LIMIT);
      expect(stats.requestsPerMinute?.current).toBe(0);
      expect(stats.requestsPerMinute?.remaining).toBe(RPM_LIMIT);

      expect(stats.requestsPerDay?.limit).toBe(RPD_LIMIT);
      expect(stats.tokensPerMinute?.limit).toBe(TPM_LIMIT);
      expect(stats.tokensPerDay?.limit).toBe(TPD_LIMIT);
    });
  });

  describe('stop', () => {
    it('should log stopped message', () => {
      const logMessages: string[] = [];
      limiter = createLLMRateLimiter({
        onLog: (message) => {
          logMessages.push(message);
        },
      });

      limiter.stop();

      expect(logMessages.some((msg) => msg.includes('Stopped'))).toBe(true);
    });

    it('should stop memory recalculation interval', () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      // Should not throw
      limiter.stop();
      limiter.stop(); // Can call multiple times safely
    });
  });

  describe('rate limiting behavior', () => {
    it('should wait when RPM limit reached', async () => {
      const RPM_LIMIT = 2;

      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: 1 },
      });

      // Execute jobs up to limit
      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      // Third job should wait (but we won't test the actual wait since it's 1 minute)
      expect(limiter.hasCapacity()).toBe(false);
    });

    it('should execute jobs in parallel up to concurrency limit', async () => {
      const MAX_CONCURRENT = 3;
      const DELAY_MS = 50;
      const JOB_COUNT = 6;

      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
      });

      const startTime = Date.now();
      const completionTimes: number[] = [];

      const job = async (): Promise<LLMJobResult> => {
        await new Promise((resolve) => {
          setTimeout(resolve, DELAY_MS);
        });
        completionTimes.push(Date.now() - startTime);
        return createMockJobResult('parallel-job');
      };

      await Promise.all(Array.from({ length: JOB_COUNT }, async () => await limiter.queueJob(job)));

      // With 6 jobs, 3 concurrent, 50ms each: should take ~100ms total (2 batches)
      const totalTime = Date.now() - startTime;
      const EXPECTED_MIN_TIME = DELAY_MS * 2; // At least 2 batches
      const EXPECTED_MAX_TIME = DELAY_MS * JOB_COUNT; // Less than sequential

      expect(totalTime).toBeGreaterThanOrEqual(EXPECTED_MIN_TIME - 10);
      expect(totalTime).toBeLessThan(EXPECTED_MAX_TIME);
    });
  });

  describe('memory configuration', () => {
    it('should respect minCapacity', () => {
      const MIN_CAPACITY = 50000; // 50KB

      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        minCapacity: MIN_CAPACITY,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const stats = limiter.getStats();
      expect(stats.memory?.maxCapacityKB).toBeGreaterThanOrEqual(MIN_CAPACITY);
    });

    it('should respect maxCapacity', () => {
      const MAX_CAPACITY = 100000; // 100KB

      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MAX_CAPACITY,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const stats = limiter.getStats();
      expect(stats.memory?.maxCapacityKB).toBeLessThanOrEqual(MAX_CAPACITY);
    });

    it('should use freeMemoryRatio', () => {
      const LOW_RATIO = 0.1;
      const HIGH_RATIO = 0.9;

      const lowRatioLimiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: LOW_RATIO },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const highRatioLimiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: HIGH_RATIO },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const lowStats = lowRatioLimiter.getStats();
      const highStats = highRatioLimiter.getStats();

      // Higher ratio should allow more capacity
      expect(highStats.memory?.maxCapacityKB).toBeGreaterThan(lowStats.memory?.maxCapacityKB ?? 0);

      lowRatioLimiter.stop();
      highRatioLimiter.stop();
    });

    it('should recalculate memory capacity periodically', async () => {
      const RECALCULATION_INTERVAL_MS = 50;

      limiter = createLLMRateLimiter({
        memory: { recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const initialStats = limiter.getStats();
      expect(initialStats.memory?.maxCapacityKB).toBeGreaterThan(0);

      // Wait for recalculation interval to fire
      await new Promise((resolve) => {
        setTimeout(resolve, RECALCULATION_INTERVAL_MS + 20);
      });

      // Stats should still be valid after recalculation
      const statsAfterRecalc = limiter.getStats();
      expect(statsAfterRecalc.memory?.maxCapacityKB).toBeGreaterThan(0);
    });

    it('should acquire and release memory KB during job execution', async () => {
      const SMALL_MAX_CAPACITY = ESTIMATED_MEMORY_KB * 2;

      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: SMALL_MAX_CAPACITY,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      let memoryDuringJob = 0;
      const DELAY_MS = 50;

      const jobPromise = limiter.queueJob(async () => {
        const stats = limiter.getStats();
        memoryDuringJob = stats.memory?.activeKB ?? 0;
        await new Promise((resolve) => {
          setTimeout(resolve, DELAY_MS);
        });
        return createMockJobResult('memory-job');
      });

      // Give it time to start
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      await jobPromise;

      expect(memoryDuringJob).toBe(ESTIMATED_MEMORY_KB);

      // After job completes, memory should be released
      const statsAfter = limiter.getStats();
      expect(statsAfter.memory?.activeKB).toBe(0);
    });

    it('should return false in hasCapacity when memory is exhausted', async () => {
      // Set max capacity to exactly one job's worth
      const MAX_CAPACITY = ESTIMATED_MEMORY_KB;

      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MAX_CAPACITY,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      expect(limiter.hasCapacity()).toBe(true);

      const DELAY_MS = 200;
      const jobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, DELAY_MS);
        });
        return createMockJobResult('blocking-job');
      });

      // Give it time to acquire the semaphore
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });

      // Memory should be exhausted now
      expect(limiter.hasCapacity()).toBe(false);

      await jobPromise;
    });
  });

  describe('time window waiting', () => {
    it('should wait and retry when time window limit is reached', async () => {
      const RPM_LIMIT = 2;

      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: 1 },
      });

      // Use up the limit
      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      // Verify no capacity
      expect(limiter.hasCapacity()).toBe(false);

      // The next job would wait - we verify the waiting behavior indirectly
      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.current).toBe(RPM_LIMIT);
      expect(stats.requestsPerMinute?.remaining).toBe(0);
      expect(stats.requestsPerMinute?.resetsInMs).toBeGreaterThan(0);
    });

    it('should track multiple time counters correctly', async () => {
      const RPM_LIMIT = 10;
      const RPD_LIMIT = 100;
      const TPM_LIMIT = 10000;
      const TPD_LIMIT = 100000;

      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        requestsPerDay: RPD_LIMIT,
        tokensPerMinute: TPM_LIMIT,
        tokensPerDay: TPD_LIMIT,
        resourcesPerEvent: {
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      });

      // Execute a few jobs
      const JOB_COUNT = 3;
      for (let i = 0; i < JOB_COUNT; i++) {
        await limiter.queueJob(() => createMockJobResult(`job-${i}`));
      }

      const stats = limiter.getStats();

      // All counters should be tracked with actual values (after refund)
      expect(stats.requestsPerMinute?.current).toBe(JOB_COUNT);
      expect(stats.requestsPerDay?.current).toBe(JOB_COUNT);

      // Tokens show actual usage (estimated equals actual in this case)
      const expectedTokens = JOB_COUNT * MOCK_TOTAL_TOKENS;
      expect(stats.tokensPerMinute?.current).toBe(expectedTokens);
      expect(stats.tokensPerDay?.current).toBe(expectedTokens);
    });
  });
});
