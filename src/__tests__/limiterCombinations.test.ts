/**
 * Comprehensive tests for individual limiters and all 57 limiter combinations.
 *
 * The 6 limiters are:
 * 1. memory - Memory-based limiting (KB-based)
 * 2. concurrency - maxConcurrentRequests
 * 3. rpm - requestsPerMinute
 * 4. rpd - requestsPerDay
 * 5. tpm - tokensPerMinute
 * 6. tpd - tokensPerDay
 *
 * This file tests:
 * - Each limiter individually (6 tests)
 * - All 57 combinations of 2+ limiters (2^6 - 1 - 6 = 57)
 *   - For each combination, tests that each participating limiter can block
 */
import { createLLMRateLimiter } from '../rateLimiter.js';

import type { LLMJobResult, LLMRateLimiterConfig, LLMRateLimiterInstance } from '../types.js';

// Test constants
const MOCK_INPUT_TOKENS = 100;
const MOCK_OUTPUT_TOKENS = 50;
const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
const ZERO_CACHED_TOKENS = 0;
const DEFAULT_REQUEST_COUNT = 1;

// Timing constants
const LONG_JOB_DELAY_MS = 1000; // How long the slow job takes
const SEMAPHORE_ACQUIRE_WAIT_MS = 100; // Wait time for semaphore to be acquired

// Memory configuration in KB
const ESTIMATED_MEMORY_KB = 10240; // 10MB in KB

// Limiter configuration values that allow exactly 1 unit before blocking
const MEMORY_MAX_CAPACITY_KB = ESTIMATED_MEMORY_KB; // Exactly one job's worth
const CONCURRENCY_LIMIT = 1;
const RPM_LIMIT = 1;
const RPD_LIMIT = 1;
const TPM_LIMIT = MOCK_TOTAL_TOKENS;
const TPD_LIMIT = MOCK_TOTAL_TOKENS;

// High limits that won't block
const HIGH_MEMORY_MAX_CAPACITY_KB = ESTIMATED_MEMORY_KB * 100;
const HIGH_CONCURRENCY = 100;
const HIGH_RPM = 1000;
const HIGH_RPD = 10000;
const HIGH_TPM = 1000000;
const HIGH_TPD = 10000000;

// Helper to create mock job results
const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): LLMJobResult => ({
  text,
  requestCount,
  usage: {
    input: MOCK_INPUT_TOKENS,
    output: MOCK_OUTPUT_TOKENS,
    cached: ZERO_CACHED_TOKENS,
  },
});

// Types for limiter identification
type LimiterType = 'memory' | 'concurrency' | 'rpm' | 'rpd' | 'tpm' | 'tpd';

// Helper to build config for given limiters with high limits (non-blocking)
const buildHighLimitConfig = (limiters: LimiterType[]): LLMRateLimiterConfig => {
  const config: LLMRateLimiterConfig = {};
  const hasMemoryLimiter = limiters.includes('memory');
  const hasRequestLimiter = limiters.includes('rpm') || limiters.includes('rpd');
  const hasTokenLimiter = limiters.includes('tpm') || limiters.includes('tpd');

  for (const limiter of limiters) {
    switch (limiter) {
      case 'memory':
        config.memory = { freeMemoryRatio: 0.8 };
        config.maxCapacity = HIGH_MEMORY_MAX_CAPACITY_KB;
        break;
      case 'concurrency':
        config.maxConcurrentRequests = HIGH_CONCURRENCY;
        break;
      case 'rpm':
        config.requestsPerMinute = HIGH_RPM;
        break;
      case 'rpd':
        config.requestsPerDay = HIGH_RPD;
        break;
      case 'tpm':
        config.tokensPerMinute = HIGH_TPM;
        break;
      case 'tpd':
        config.tokensPerDay = HIGH_TPD;
        break;
    }
  }

  // Build resourcesPerEvent based on which limiters are configured
  if (hasMemoryLimiter || hasRequestLimiter || hasTokenLimiter) {
    config.resourcesPerEvent = {};
    if (hasMemoryLimiter) {
      config.resourcesPerEvent.estimatedUsedMemoryKB = ESTIMATED_MEMORY_KB;
    }
    if (hasRequestLimiter) {
      config.resourcesPerEvent.estimatedNumberOfRequests = DEFAULT_REQUEST_COUNT;
    }
    if (hasTokenLimiter) {
      config.resourcesPerEvent.estimatedUsedTokens = MOCK_TOTAL_TOKENS;
    }
  }

  return config;
};

// Helper to build config where one limiter blocks and others have high limits
const buildConfigWithBlockingLimiter = (
  allLimiters: LimiterType[],
  blockingLimiter: LimiterType
): LLMRateLimiterConfig => {
  const config = buildHighLimitConfig(allLimiters);
  // Override the blocking limiter with restrictive limit
  switch (blockingLimiter) {
    case 'memory':
      config.maxCapacity = MEMORY_MAX_CAPACITY_KB;
      break;
    case 'concurrency':
      config.maxConcurrentRequests = CONCURRENCY_LIMIT;
      break;
    case 'rpm':
      config.requestsPerMinute = RPM_LIMIT;
      break;
    case 'rpd':
      config.requestsPerDay = RPD_LIMIT;
      break;
    case 'tpm':
      config.tokensPerMinute = TPM_LIMIT;
      break;
    case 'tpd':
      config.tokensPerDay = TPD_LIMIT;
      break;
  }
  return config;
};

// Helper to check which limiter is blocking
const getBlockingReason = (
  limiter: LLMRateLimiterInstance,
  activeLimiters: LimiterType[]
): LimiterType | null => {
  const stats = limiter.getStats();

  for (const lt of activeLimiters) {
    switch (lt) {
      case 'memory':
        if (stats.memory !== undefined && stats.memory.availableKB < ESTIMATED_MEMORY_KB) {
          return 'memory';
        }
        break;
      case 'concurrency':
        if (stats.concurrency !== undefined && stats.concurrency.available <= 0) {
          return 'concurrency';
        }
        break;
      case 'rpm':
        if (stats.requestsPerMinute !== undefined && stats.requestsPerMinute.remaining <= 0) {
          return 'rpm';
        }
        break;
      case 'rpd':
        if (stats.requestsPerDay !== undefined && stats.requestsPerDay.remaining <= 0) {
          return 'rpd';
        }
        break;
      case 'tpm':
        if (stats.tokensPerMinute !== undefined && stats.tokensPerMinute.remaining <= 0) {
          return 'tpm';
        }
        break;
      case 'tpd':
        if (stats.tokensPerDay !== undefined && stats.tokensPerDay.remaining <= 0) {
          return 'tpd';
        }
        break;
    }
  }
  return null;
};

describe('Individual Limiter Tests', () => {
  let limiter: LLMRateLimiterInstance;

  afterEach(() => {
    limiter?.stop();
  });

  describe('memory limiter only', () => {
    it('should block when memory limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_MAX_CAPACITY_KB,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      expect(limiter.hasCapacity()).toBe(true);

      // Start a slow job inline
      const jobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_JOB_DELAY_MS);
        });
        return createMockJobResult('slow-job');
      });

      await new Promise((resolve) => {
        setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
      });

      const stats = limiter.getStats();
      expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
      expect(stats.memory?.availableKB).toBe(0);
      expect(limiter.hasCapacity()).toBe(false);

      await jobPromise;
    });

    it('should restore capacity after job completes', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_MAX_CAPACITY_KB,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(true);
      const stats = limiter.getStats();
      expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
      expect(stats.memory?.activeKB).toBe(0);
    });
  });

  describe('concurrency limiter only', () => {
    it('should block when concurrency limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: CONCURRENCY_LIMIT,
      });

      expect(limiter.hasCapacity()).toBe(true);

      // Start a slow job inline
      const jobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_JOB_DELAY_MS);
        });
        return createMockJobResult('slow-job');
      });

      await new Promise((resolve) => {
        setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
      });

      const stats = limiter.getStats();
      expect(stats.concurrency?.active).toBe(1);
      expect(stats.concurrency?.available).toBe(0);
      expect(limiter.hasCapacity()).toBe(false);

      await jobPromise;
    });

    it('should restore capacity after job completes', async () => {
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: CONCURRENCY_LIMIT,
      });

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(true);
      const stats = limiter.getStats();
      expect(stats.concurrency?.available).toBe(1);
      expect(stats.concurrency?.active).toBe(0);
    });
  });

  describe('rpm limiter only', () => {
    it('should block when RPM limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      expect(limiter.hasCapacity()).toBe(true);

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.remaining).toBe(0);
      expect(stats.requestsPerMinute?.current).toBe(1);
    });
  });

  describe('rpd limiter only', () => {
    it('should block when RPD limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        requestsPerDay: RPD_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      expect(limiter.hasCapacity()).toBe(true);

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.requestsPerDay?.remaining).toBe(0);
      expect(stats.requestsPerDay?.current).toBe(1);
    });
  });

  describe('tpm limiter only', () => {
    it('should block when TPM limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      expect(limiter.hasCapacity()).toBe(true);

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.tokensPerMinute?.remaining).toBe(0);
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
    });
  });

  describe('tpd limiter only', () => {
    it('should block when TPD limit is exhausted', async () => {
      limiter = createLLMRateLimiter({
        tokensPerDay: TPD_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      expect(limiter.hasCapacity()).toBe(true);

      await limiter.queueJob(() => createMockJobResult('job-1'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.tokensPerDay?.remaining).toBe(0);
      expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
    });
  });
});

// All possible combinations of 2+ limiters (57 total)
// Combinations of 2: C(6,2) = 15
// Combinations of 3: C(6,3) = 20
// Combinations of 4: C(6,4) = 15
// Combinations of 5: C(6,5) = 6
// Combinations of 6: C(6,6) = 1
// Total: 15 + 20 + 15 + 6 + 1 = 57

const allLimiters: LimiterType[] = ['memory', 'concurrency', 'rpm', 'rpd', 'tpm', 'tpd'];

// Generate all combinations of k elements from array
const combinations = <T>(arr: T[], k: number): T[][] => {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
};

// Generate all combinations of 2 or more limiters
const allCombinations: LimiterType[][] = [];
for (let k = 2; k <= 6; k++) {
  allCombinations.push(...combinations(allLimiters, k));
}

// Verify we have exactly 57 combinations
if (allCombinations.length !== 57) {
  throw new Error(`Expected 57 combinations, got ${allCombinations.length}`);
}

describe('Limiter Combination Tests (57 combinations)', () => {
  let limiter: LLMRateLimiterInstance;

  afterEach(() => {
    limiter?.stop();
  });

  // Helper function to run blocking test for semaphore-based limiters (memory, concurrency)
  const testSemaphoreBlocker = async (
    limiters: LimiterType[],
    blocker: LimiterType
  ): Promise<void> => {
    const config = buildConfigWithBlockingLimiter(limiters, blocker);
    limiter = createLLMRateLimiter(config);

    expect(limiter.hasCapacity()).toBe(true);

    // Start a slow job - don't use helper, do it inline
    const slowJobPromise = limiter.queueJob(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, LONG_JOB_DELAY_MS);
      });
      return createMockJobResult('slow-job');
    });

    // Wait for semaphore to be acquired
    await new Promise((resolve) => {
      setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
    });

    const stats = limiter.getStats();
    if (blocker === 'memory') {
      expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
      expect(stats.memory?.availableKB).toBe(0);
    } else if (blocker === 'concurrency') {
      expect(stats.concurrency?.active).toBe(1);
      expect(stats.concurrency?.available).toBe(0);
    }
    expect(limiter.hasCapacity()).toBe(false);
    expect(getBlockingReason(limiter, limiters)).toBe(blocker);

    await slowJobPromise;
  };

  // Helper function to run blocking test for time-window limiters (rpm, rpd, tpm, tpd)
  const testTimeWindowBlocker = async (
    limiters: LimiterType[],
    blocker: LimiterType
  ): Promise<void> => {
    const config = buildConfigWithBlockingLimiter(limiters, blocker);
    limiter = createLLMRateLimiter(config);

    expect(limiter.hasCapacity()).toBe(true);

    // Execute one job to exhaust the time window counter
    await limiter.queueJob(() => createMockJobResult('exhaust-job'));

    expect(limiter.hasCapacity()).toBe(false);
    expect(getBlockingReason(limiter, limiters)).toBe(blocker);
  };

  // Generate tests for each combination
  describe('Combinations of 2 limiters (15 combinations)', () => {
    const twoLimiterCombinations = combinations(allLimiters, 2);

    for (const combo of twoLimiterCombinations) {
      describe(combo.join(' + '), () => {
        for (const blocker of combo) {
          it(`should block when ${blocker} is exhausted`, async () => {
            if (blocker === 'memory' || blocker === 'concurrency') {
              await testSemaphoreBlocker(combo, blocker);
            } else {
              await testTimeWindowBlocker(combo, blocker);
            }
          });
        }

        it('should have capacity when no limiter is exhausted', () => {
          const config = buildHighLimitConfig(combo);
          limiter = createLLMRateLimiter(config);
          expect(limiter.hasCapacity()).toBe(true);
        });
      });
    }
  });

  describe('Combinations of 3 limiters (20 combinations)', () => {
    const threeLimiterCombinations = combinations(allLimiters, 3);

    for (const combo of threeLimiterCombinations) {
      describe(combo.join(' + '), () => {
        for (const blocker of combo) {
          it(`should block when ${blocker} is exhausted`, async () => {
            if (blocker === 'memory' || blocker === 'concurrency') {
              await testSemaphoreBlocker(combo, blocker);
            } else {
              await testTimeWindowBlocker(combo, blocker);
            }
          });
        }

        it('should have capacity when no limiter is exhausted', () => {
          const config = buildHighLimitConfig(combo);
          limiter = createLLMRateLimiter(config);
          expect(limiter.hasCapacity()).toBe(true);
        });
      });
    }
  });

  describe('Combinations of 4 limiters (15 combinations)', () => {
    const fourLimiterCombinations = combinations(allLimiters, 4);

    for (const combo of fourLimiterCombinations) {
      describe(combo.join(' + '), () => {
        for (const blocker of combo) {
          it(`should block when ${blocker} is exhausted`, async () => {
            if (blocker === 'memory' || blocker === 'concurrency') {
              await testSemaphoreBlocker(combo, blocker);
            } else {
              await testTimeWindowBlocker(combo, blocker);
            }
          });
        }

        it('should have capacity when no limiter is exhausted', () => {
          const config = buildHighLimitConfig(combo);
          limiter = createLLMRateLimiter(config);
          expect(limiter.hasCapacity()).toBe(true);
        });
      });
    }
  });

  describe('Combinations of 5 limiters (6 combinations)', () => {
    const fiveLimiterCombinations = combinations(allLimiters, 5);

    for (const combo of fiveLimiterCombinations) {
      describe(combo.join(' + '), () => {
        for (const blocker of combo) {
          it(`should block when ${blocker} is exhausted`, async () => {
            if (blocker === 'memory' || blocker === 'concurrency') {
              await testSemaphoreBlocker(combo, blocker);
            } else {
              await testTimeWindowBlocker(combo, blocker);
            }
          });
        }

        it('should have capacity when no limiter is exhausted', () => {
          const config = buildHighLimitConfig(combo);
          limiter = createLLMRateLimiter(config);
          expect(limiter.hasCapacity()).toBe(true);
        });
      });
    }
  });

  describe('Combination of all 6 limiters (1 combination)', () => {
    const combo = allLimiters;

    describe(combo.join(' + '), () => {
      for (const blocker of combo) {
        it(`should block when ${blocker} is exhausted`, async () => {
          if (blocker === 'memory' || blocker === 'concurrency') {
            await testSemaphoreBlocker(combo, blocker);
          } else {
            await testTimeWindowBlocker(combo, blocker);
          }
        });
      }

      it('should have capacity when no limiter is exhausted', () => {
        const config = buildHighLimitConfig(combo);
        limiter = createLLMRateLimiter(config);
        expect(limiter.hasCapacity()).toBe(true);
      });

      it('should track all stats correctly', async () => {
        const config = buildHighLimitConfig(combo);
        limiter = createLLMRateLimiter(config);

        await limiter.queueJob(() => createMockJobResult('tracked-job'));

        const stats = limiter.getStats();
        expect(stats.memory).toBeDefined();
        expect(stats.concurrency).toBeDefined();
        expect(stats.requestsPerMinute).toBeDefined();
        expect(stats.requestsPerDay).toBeDefined();
        expect(stats.tokensPerMinute).toBeDefined();
        expect(stats.tokensPerDay).toBeDefined();

        expect(stats.requestsPerMinute?.current).toBe(1);
        expect(stats.requestsPerDay?.current).toBe(1);
        expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
        expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
      });
    });
  });
});

describe('Blocking Behavior Verification', () => {
  let limiter: LLMRateLimiterInstance;

  afterEach(() => {
    limiter?.stop();
  });

  describe('concurrency limiter actually blocks jobs', () => {
    it('should queue jobs beyond concurrency limit and execute them in order', async () => {
      const MAX_CONCURRENT = 2;
      limiter = createLLMRateLimiter({ maxConcurrentRequests: MAX_CONCURRENT });

      const jobOrder: string[] = [];
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};
      const start = Date.now();
      const JOB_DELAY_MS = 150;
      const SHORT_JOB_DELAY_MS = 50;

      const createTrackedJob = (id: string, delayMs: number) => async (): Promise<LLMJobResult> => {
        startTimes[id] = Date.now();
        jobOrder.push(`start-${  id}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        endTimes[id] = Date.now();
        jobOrder.push(`end-${  id}`);
        return createMockJobResult(id);
      };

      // Start 4 jobs with concurrency limit of 2
      const promises = [
        limiter.queueJob(createTrackedJob('A', JOB_DELAY_MS)),
        limiter.queueJob(createTrackedJob('B', JOB_DELAY_MS)),
        limiter.queueJob(createTrackedJob('C', SHORT_JOB_DELAY_MS)),
        limiter.queueJob(createTrackedJob('D', SHORT_JOB_DELAY_MS)),
      ];

      await Promise.all(promises);
      const totalTime = Date.now() - start;

      // Jobs A and B should start first (at ~0ms)
      // Jobs C and D should start after A or B finishes (at ~150ms)
      const firstTwoEnded = Math.min(endTimes.A, endTimes.B);
      const lastTwoStarted = Math.min(startTimes.C, startTimes.D);
      const TOLERANCE = 30;

      expect(lastTwoStarted).toBeGreaterThanOrEqual(firstTwoEnded - TOLERANCE);

      // Total time should be ~200ms (150ms + 50ms), not ~150ms
      const EXPECTED_MIN_TIME = JOB_DELAY_MS + SHORT_JOB_DELAY_MS - TOLERANCE;
      expect(totalTime).toBeGreaterThanOrEqual(EXPECTED_MIN_TIME);
    });
  });

  describe('memory limiter actually blocks jobs', () => {
    it('should queue jobs when memory slots are exhausted', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_MAX_CAPACITY_KB,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const jobOrder: string[] = [];
      const SLOW_JOB_DELAY_MS = 200;

      // Start a slow job that holds the memory slot
      const slowJobPromise = limiter.queueJob(async () => {
        jobOrder.push('slow-start');
        await new Promise((resolve) => setTimeout(resolve, SLOW_JOB_DELAY_MS));
        jobOrder.push('slow-end');
        return createMockJobResult('slow');
      });

      // Wait for slow job to acquire the slot
      await new Promise((resolve) => setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS));

      // Verify no capacity
      expect(limiter.hasCapacity()).toBe(false);

      // Start a fast job - it should wait
      const fastJobPromise = limiter.queueJob(async () => {
        jobOrder.push('fast-start');
        jobOrder.push('fast-end');
        return createMockJobResult('fast');
      });

      await Promise.all([slowJobPromise, fastJobPromise]);

      // Fast job should start AFTER slow job ends
      const slowEndIndex = jobOrder.indexOf('slow-end');
      const fastStartIndex = jobOrder.indexOf('fast-start');

      expect(fastStartIndex).toBeGreaterThan(slowEndIndex);
    });
  });

  describe('rpm limiter actually blocks jobs', () => {
    it('should block jobs when RPM limit is exhausted', async () => {
      const RPM_LIMIT = 2;
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      // Use up the RPM limit
      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      expect(limiter.hasCapacity()).toBe(false);

      // Try to queue another job - it should block
      const TIMEOUT_MS = 300;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => { resolve('timeout'); }, TIMEOUT_MS);
      });

      const jobPromise = limiter
        .queueJob(() => createMockJobResult('job-3'))
        .then(() => 'completed' as const);

      const result = await Promise.race([jobPromise, timeoutPromise]);

      // Job should still be waiting (blocked)
      expect(result).toBe('timeout');
    });
  });

  describe('tpm limiter behavior', () => {
    it('should reserve tokens before job execution and block when limit would be exceeded', async () => {
      const ESTIMATED_TOKENS = 50;
      const TPM_LIMIT = ESTIMATED_TOKENS * 2; // Allow exactly 2 jobs

      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
      });

      // Execute first job - reserves 50 tokens
      await limiter.queueJob(() => createMockJobResult('job-1'));

      let stats = limiter.getStats();
      expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
      expect(limiter.hasCapacity()).toBe(true); // Can fit one more job

      // Execute second job - reserves another 50 tokens
      await limiter.queueJob(() => createMockJobResult('job-2'));

      stats = limiter.getStats();
      expect(stats.tokensPerMinute?.current).toBe(TPM_LIMIT);
      expect(limiter.hasCapacity()).toBe(false); // No capacity for third job

      // Third job should be blocked (would exceed limit)
      const TIMEOUT_MS = 300;
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        setTimeout(() => { resolve('timeout'); }, TIMEOUT_MS);
      });

      const jobPromise = limiter
        .queueJob(() => createMockJobResult('blocked-job'))
        .then(() => 'completed' as const);

      const result = await Promise.race([jobPromise, timeoutPromise]);
      expect(result).toBe('timeout');
    });

    it('should never exceed token limit', async () => {
      const ESTIMATED_TOKENS = 100;
      const TPM_LIMIT = ESTIMATED_TOKENS; // Allow exactly 1 job

      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: ESTIMATED_TOKENS },
      });

      // First job should succeed
      await limiter.queueJob(() => createMockJobResult('job-1'));

      const stats = limiter.getStats();
      // Current tokens should never exceed the limit
      expect(stats.tokensPerMinute?.current).toBeLessThanOrEqual(TPM_LIMIT);
      expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
    });
  });

  describe('combined limiters block correctly', () => {
    it('should block when any limiter is exhausted', async () => {
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: 1,
        requestsPerMinute: 10,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      // Start a slow job to hold concurrency
      const slowJobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => setTimeout(resolve, LONG_JOB_DELAY_MS));
        return createMockJobResult('slow');
      });

      await new Promise((resolve) => setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS));

      // Should be blocked by concurrency, not RPM
      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.concurrency?.available).toBe(0);
      expect(stats.requestsPerMinute?.remaining).toBe(9); // RPM has capacity

      await slowJobPromise;
    });
  });
});

describe('Edge Cases for Limiter Combinations', () => {
  let limiter: LLMRateLimiterInstance;

  afterEach(() => {
    limiter?.stop();
  });

  describe('multiple limiters exhausted simultaneously', () => {
    it('should report no capacity when both memory and concurrency are exhausted', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_MAX_CAPACITY_KB,
        maxConcurrentRequests: CONCURRENCY_LIMIT,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      // Start a slow job inline
      const jobPromise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_JOB_DELAY_MS);
        });
        return createMockJobResult('slow-job');
      });

      await new Promise((resolve) => {
        setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
      });

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.memory?.availableKB).toBe(0);
      expect(stats.concurrency?.available).toBe(0);

      await jobPromise;
    });

    it('should report no capacity when both rpm and rpd are exhausted', async () => {
      limiter = createLLMRateLimiter({
        requestsPerMinute: RPM_LIMIT,
        requestsPerDay: RPD_LIMIT,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      await limiter.queueJob(() => createMockJobResult('exhaust-job'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.remaining).toBe(0);
      expect(stats.requestsPerDay?.remaining).toBe(0);
    });

    it('should report no capacity when both tpm and tpd are exhausted', async () => {
      limiter = createLLMRateLimiter({
        tokensPerMinute: TPM_LIMIT,
        tokensPerDay: TPD_LIMIT,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      await limiter.queueJob(() => createMockJobResult('exhaust-job'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.tokensPerMinute?.remaining).toBe(0);
      expect(stats.tokensPerDay?.remaining).toBe(0);
    });

    it('should report no capacity when all time-based limiters are exhausted', async () => {
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

      await limiter.queueJob(() => createMockJobResult('exhaust-job'));

      expect(limiter.hasCapacity()).toBe(false);
      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.remaining).toBe(0);
      expect(stats.requestsPerDay?.remaining).toBe(0);
      expect(stats.tokensPerMinute?.remaining).toBe(0);
      expect(stats.tokensPerDay?.remaining).toBe(0);
    });
  });

  describe('resource release on error', () => {
    it('should release memory and concurrency on job failure', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_MAX_CAPACITY_KB,
        maxConcurrentRequests: CONCURRENCY_LIMIT,
        resourcesPerEvent: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB },
      });

      const failingJob = async (): Promise<LLMJobResult> => {
        throw new Error('Intentional failure');
      };

      await expect(limiter.queueJob(failingJob)).rejects.toThrow('Intentional failure');

      expect(limiter.hasCapacity()).toBe(true);
      const stats = limiter.getStats();
      expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
      expect(stats.concurrency?.available).toBe(1);
    });

    it('should still increment request counters even on job failure', async () => {
      limiter = createLLMRateLimiter({
        requestsPerMinute: 10,
        requestsPerDay: 100,
        resourcesPerEvent: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT },
      });

      const failingJob = async (): Promise<LLMJobResult> => {
        throw new Error('Intentional failure');
      };

      await expect(limiter.queueJob(failingJob)).rejects.toThrow('Intentional failure');

      const stats = limiter.getStats();
      // Request counters are incremented before job execution
      expect(stats.requestsPerMinute?.current).toBe(1);
      expect(stats.requestsPerDay?.current).toBe(1);
    });

    it('should still reserve tokens even on job failure', async () => {
      limiter = createLLMRateLimiter({
        tokensPerMinute: 10000,
        tokensPerDay: 100000,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      const failingJob = async (): Promise<LLMJobResult> => {
        throw new Error('Intentional failure');
      };

      await expect(limiter.queueJob(failingJob)).rejects.toThrow('Intentional failure');

      const stats = limiter.getStats();
      // Tokens are reserved BEFORE job execution, so they're counted even on failure
      // This is the safer behavior - ensures we never exceed limits
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
      expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
    });
  });

  describe('mixed semaphore and time-window limiters', () => {
    it('should handle memory + rpm combination correctly', async () => {
      const MEMORY_CAPACITY = ESTIMATED_MEMORY_KB * 2;
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: MEMORY_CAPACITY,
        requestsPerMinute: 3,
        resourcesPerEvent: {
          estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
        },
      });

      // Start first slow job
      const job1Promise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_JOB_DELAY_MS);
        });
        return createMockJobResult('slow-job-1');
      });

      await new Promise((resolve) => {
        setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
      });

      // At this point we've started 1 job, memory should have some KB used
      let stats = limiter.getStats();
      expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
      expect(stats.memory?.availableKB).toBe(ESTIMATED_MEMORY_KB);

      // Start another slow job
      const job2Promise = limiter.queueJob(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, LONG_JOB_DELAY_MS);
        });
        return createMockJobResult('slow-job-2');
      });
      await new Promise((resolve) => {
        setTimeout(resolve, SEMAPHORE_ACQUIRE_WAIT_MS);
      });

      // Memory should be exhausted now
      stats = limiter.getStats();
      expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB * 2);
      expect(stats.memory?.availableKB).toBe(0);
      expect(limiter.hasCapacity()).toBe(false);

      // RPM should still have capacity (2 used, 1 remaining)
      expect(stats.requestsPerMinute?.current).toBe(2);
      expect(stats.requestsPerMinute?.remaining).toBe(1);

      await Promise.all([job1Promise, job2Promise]);
    });

    it('should handle concurrency + tpm combination correctly', async () => {
      limiter = createLLMRateLimiter({
        maxConcurrentRequests: 2,
        tokensPerMinute: MOCK_TOTAL_TOKENS * 3,
        resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS },
      });

      // Execute jobs
      await limiter.queueJob(() => createMockJobResult('job-1'));
      await limiter.queueJob(() => createMockJobResult('job-2'));

      const stats = limiter.getStats();
      expect(stats.concurrency?.available).toBe(2);
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS * 2);
      expect(stats.tokensPerMinute?.remaining).toBe(MOCK_TOTAL_TOKENS);
    });
  });

  describe('concurrent jobs with all limiters', () => {
    it('should handle multiple concurrent jobs with all limiters active', async () => {
      limiter = createLLMRateLimiter({
        memory: { freeMemoryRatio: 0.8 },
        maxCapacity: ESTIMATED_MEMORY_KB * 10,
        maxConcurrentRequests: 3,
        requestsPerMinute: 10,
        requestsPerDay: 100,
        tokensPerMinute: MOCK_TOTAL_TOKENS * 10,
        tokensPerDay: MOCK_TOTAL_TOKENS * 100,
        resourcesPerEvent: {
          estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      });

      const JOB_COUNT = 5;
      const results = await Promise.all(
        Array.from({ length: JOB_COUNT }, async (_, i) =>
          await limiter.queueJob(() => createMockJobResult(`job-${i}`))
        )
      );

      expect(results).toHaveLength(JOB_COUNT);

      const stats = limiter.getStats();
      expect(stats.requestsPerMinute?.current).toBe(JOB_COUNT);
      expect(stats.requestsPerDay?.current).toBe(JOB_COUNT);
      expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS * JOB_COUNT);
      expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS * JOB_COUNT);
    });

    it('should correctly limit concurrency even with multiple time limiters', async () => {
      const MAX_CONCURRENT = 2;
      const SHORT_JOB_DELAY_MS = 30;

      limiter = createLLMRateLimiter({
        maxConcurrentRequests: MAX_CONCURRENT,
        requestsPerMinute: 100,
        tokensPerMinute: MOCK_TOTAL_TOKENS * 100,
        resourcesPerEvent: {
          estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT,
          estimatedUsedTokens: MOCK_TOTAL_TOKENS,
        },
      });

      let concurrentCount = 0;
      let maxConcurrent = 0;

      const job = async (): Promise<LLMJobResult> => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((resolve) => {
          setTimeout(resolve, SHORT_JOB_DELAY_MS);
        });
        concurrentCount--;
        return createMockJobResult('concurrent-job');
      };

      const JOB_COUNT = 6;
      await Promise.all(Array.from({ length: JOB_COUNT }, async () => await limiter.queueJob(job)));

      expect(maxConcurrent).toBe(MAX_CONCURRENT);
    });
  });
});
