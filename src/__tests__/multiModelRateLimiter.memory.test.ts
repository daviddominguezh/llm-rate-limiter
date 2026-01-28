import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { resetSharedMemoryState } from '../utils/memoryManager.js';
import {
  DEFAULT_PRICING,
  DELAY_MS_SHORT,
  ONE,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  ZERO,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

// Reset shared memory state before each test to ensure isolation
beforeEach(() => {
  resetSharedMemoryState();
});

const MEMORY_KB = 1000;
const LARGE_MEMORY_KB = 2000;
const RECALCULATION_INTERVAL_MS = 50;
const FREE_MEMORY_RATIO = 0.5;
const INTERVAL_MULTIPLIER = 2;
const MAX_CAPACITY = 5000;
const MIN_CAPACITY = 1000;

describe('MultiModelRateLimiter - memory config create', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should create limiter with memory configuration', () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
          pricing: DEFAULT_PRICING,
        },
      },
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
    });
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
  });

  it('should throw error when memory config but no estimatedUsedMemoryKB', () => {
    expect(() =>
      createLLMRateLimiter({
        models: {
          'gpt-4': {
            requestsPerMinute: RPM_LIMIT_HIGH,
            resourcesPerEvent: { estimatedNumberOfRequests: ONE },
            pricing: DEFAULT_PRICING,
          },
        },
        memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      })
    ).toThrow(
      'resourcesPerEvent.estimatedUsedMemoryKB is required in at least one model when memory limits are configured'
    );
  });
});

describe('MultiModelRateLimiter - memory config stats', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should include memory stats when memory config is provided', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
          pricing: DEFAULT_PRICING,
        },
      },
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const stats = limiter.getStats();
    expect(stats.memory).toBeDefined();
    expect(stats.memory?.activeKB).toBe(ZERO);
    expect(stats.memory?.maxCapacityKB).toBeGreaterThan(ZERO);
    expect(stats.memory?.availableKB).toBeGreaterThan(ZERO);
    expect(stats.memory?.systemAvailableKB).toBeGreaterThan(ZERO);
  });
});

describe('MultiModelRateLimiter - memory capacity bounds', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should respect minCapacity and maxCapacity', () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
          pricing: DEFAULT_PRICING,
        },
      },
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
      minCapacity: MIN_CAPACITY,
      maxCapacity: MAX_CAPACITY,
    });
    const stats = limiter.getStats();
    expect(stats.memory?.maxCapacityKB).toBeLessThanOrEqual(MAX_CAPACITY);
    expect(stats.memory?.maxCapacityKB).toBeGreaterThanOrEqual(MIN_CAPACITY);
  });
});

describe('MultiModelRateLimiter - memory recalculation', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should recalculate memory capacity on interval', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB },
          pricing: DEFAULT_PRICING,
        },
      },
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS },
    });
    const initialStats = limiter.getStats();
    await setTimeoutAsync(RECALCULATION_INTERVAL_MS * INTERVAL_MULTIPLIER);
    const laterStats = limiter.getStats();
    expect(laterStats.memory).toBeDefined();
    expect(initialStats.memory).toBeDefined();
  });
});

describe('MultiModelRateLimiter - memory with multiple models', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });
  const memoryConfig = { freeMemoryRatio: FREE_MEMORY_RATIO, recalculationIntervalMs: RECALCULATION_INTERVAL_MS };

  it('should use max estimated memory across all models', () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: LARGE_MEMORY_KB }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'], memory: memoryConfig,
    });
    expect(limiter.hasCapacity()).toBe(true);
  });

  it('should check memory capacity per model', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: MEMORY_KB }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'], memory: memoryConfig,
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(true);
    expect(limiter.hasCapacityForModel('gpt-3.5')).toBe(true);
  });
});

describe('MultiModelRateLimiter - logging', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });
  const defaultModel = { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } };

  it('should call onLog callback during initialization and stop', () => {
    const logMessages: Array<{ message: string; data?: Record<string, unknown> }> = [];
    limiter = createLLMRateLimiter({ models: defaultModel, onLog: (message, data) => { logMessages.push({ message, data }); } });
    expect(logMessages.some((l) => l.message.includes('Initialized'))).toBe(true);
    limiter.stop();
    expect(logMessages.some((l) => l.message.includes('Stopped'))).toBe(true);
    limiter = undefined;
  });

  it('should include custom label in log messages', () => {
    const logMessages: string[] = [];
    const CUSTOM_LABEL = 'MyCustomLimiter';
    limiter = createLLMRateLimiter({ models: defaultModel, label: CUSTOM_LABEL, onLog: (message) => { logMessages.push(message); } });
    expect(logMessages.some((m) => m.includes(CUSTOM_LABEL))).toBe(true);
  });
});

describe('MultiModelRateLimiter - waitForAnyModelCapacity', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });
  const noop = (): void => { /* no-op */ };

  it('should wait for capacity when all models are exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result1 = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const result2 = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result1.modelUsed).toBe('gpt-4');
    expect(result2.modelUsed).toBe('gpt-3.5');
    expect(limiter.hasCapacity()).toBe(false);
    let job3Resolved = false;
    const job3Promise = limiter.queueJob({
      jobId: 'job-3',
      job: ({ modelId }, resolve) => { job3Resolved = true; resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }); return createMockJobResult('job-3'); },
    });
    await setTimeoutAsync(DELAY_MS_SHORT);
    expect(job3Resolved).toBe(false);
    limiter.stop();
    limiter = undefined;
    await job3Promise.catch(noop);
  });
});

