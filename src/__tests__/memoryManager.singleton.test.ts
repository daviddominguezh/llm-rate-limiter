/**
 * Tests for the singleton memory manager behavior.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { resetSharedMemoryState } from '../utils/memoryManager.js';
import { createMockJobResult, DEFAULT_PRICING, ONE, RPM_LIMIT_HIGH, simpleJob, ZERO } from './multiModelRateLimiter.helpers.js';

const MEMORY_KB = 1000;
const RECALCULATION_INTERVAL_MS = 50;
const FREE_MEMORY_RATIO = 0.5;
const SMALL_MAX_CAPACITY = 3000;

// Reset shared memory state before each test to ensure isolation
beforeEach(() => {
  resetSharedMemoryState();
});

const memoryConfig = { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS };

const createGpt4Limiter = (): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    models: {
      'gpt-4': {
        requestsPerMinute: RPM_LIMIT_HIGH,
        resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
        pricing: DEFAULT_PRICING,
      },
    },
    memory: memoryConfig,
    maxCapacity: SMALL_MAX_CAPACITY,
  });

const createClaudeLimiter = (): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    models: {
      claude: {
        requestsPerMinute: RPM_LIMIT_HIGH,
        resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
        pricing: DEFAULT_PRICING,
      },
    },
    memory: memoryConfig,
    maxCapacity: SMALL_MAX_CAPACITY,
  });

describe('shared memory singleton - pool sharing', () => {
  let limiter1: LLMRateLimiterInstance | undefined = undefined;
  let limiter2: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter1?.stop(); limiter2?.stop(); limiter1 = undefined; limiter2 = undefined; });

  it('should share memory pool across multiple rate limiters', () => {
    limiter1 = createGpt4Limiter();
    limiter2 = createClaudeLimiter();
    const stats1 = limiter1.getStats();
    const stats2 = limiter2.getStats();
    expect(stats1.memory?.maxCapacityKB).toBe(stats2.memory?.maxCapacityKB);
    expect(stats1.memory?.availableKB).toBe(stats2.memory?.availableKB);
  });
});

describe('shared memory singleton - tracking', () => {
  let limiter1: LLMRateLimiterInstance | undefined = undefined;
  let limiter2: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter1?.stop(); limiter2?.stop(); limiter1 = undefined; limiter2 = undefined; });

  it('should track memory usage across multiple limiters', async () => {
    limiter1 = createGpt4Limiter();
    limiter2 = createClaudeLimiter();
    const initialStats = limiter1.getStats();
    const initialAvailable = initialStats.memory?.availableKB ?? ZERO;
    await limiter1.queueJob(simpleJob(createMockJobResult('job-1')));
    const stats1After = limiter1.getStats();
    const stats2After = limiter2.getStats();
    expect(stats1After.memory?.availableKB).toBe(stats2After.memory?.availableKB);
    expect(stats1After.memory?.availableKB).toBe(initialAvailable);
  });
});

describe('shared memory singleton - lifecycle', () => {
  let limiter1: LLMRateLimiterInstance | undefined = undefined;
  let limiter2: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter1?.stop(); limiter2?.stop(); limiter1 = undefined; limiter2 = undefined; });

  it('should keep singleton alive until all limiters are stopped', () => {
    limiter1 = createGpt4Limiter();
    limiter2 = createClaudeLimiter();
    limiter1.stop();
    limiter1 = undefined;
    const stats2 = limiter2.getStats();
    expect(stats2.memory).toBeDefined();
    expect(stats2.memory?.maxCapacityKB).toBeGreaterThan(ZERO);
  });
});
