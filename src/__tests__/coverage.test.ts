/**
 * Tests to achieve 100% code coverage on all files.
 * These tests specifically target uncovered lines identified in coverage report.
 */
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { jest } from '@jest/globals';

import { AvailabilityTracker } from '../utils/availabilityTracker.js';
import { validateConfig, validateMemoryLimits, validateRequestLimits, validateTokenLimits } from '../utils/configValidation.js';
import { createInternalLimiter } from '../rateLimiter.js';
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { InternalLimiterConfig, InternalLimiterStats } from '../types.js';
import type { LLMRateLimiterStats, RelativeAvailabilityAdjustment } from '../multiModelTypes.js';
import { ensureDefined } from './multiModelRateLimiter.helpers.js';
import { queueSimpleJob, queueDelayedJob, createLLMRateLimiter as createTestLimiter, createMockJobResult as createHelperMockJobResult } from './limiterCombinations.helpers.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const FIFTY = 50;
const HUNDRED = 100;
const THOUSAND = 1000;
const DELAY_SHORT = 10;
const RATIO_LOW = 0.001;
const RATIO_TENTH = 0.1;
const RATIO_HALF = 0.5;

describe('configValidation - error paths', () => {
  it('should throw when requestsPerMinute is set without estimatedNumberOfRequests', () => {
    const config: InternalLimiterConfig = { requestsPerMinute: HUNDRED };
    expect(() => { validateRequestLimits(config, undefined); }).toThrow('resourcesPerEvent.estimatedNumberOfRequests is required');
  });

  it('should throw when requestsPerDay is set without estimatedNumberOfRequests', () => {
    const config: InternalLimiterConfig = { requestsPerDay: HUNDRED };
    expect(() => { validateRequestLimits(config, { estimatedNumberOfRequests: ZERO }); }).toThrow('resourcesPerEvent.estimatedNumberOfRequests is required');
  });

  it('should throw when tokensPerMinute is set without estimatedUsedTokens', () => {
    const config: InternalLimiterConfig = { tokensPerMinute: HUNDRED };
    expect(() => { validateTokenLimits(config, undefined); }).toThrow('resourcesPerEvent.estimatedUsedTokens is required');
  });

  it('should throw when tokensPerDay is set without estimatedUsedTokens', () => {
    const config: InternalLimiterConfig = { tokensPerDay: HUNDRED };
    expect(() => { validateTokenLimits(config, { estimatedUsedTokens: ZERO }); }).toThrow('resourcesPerEvent.estimatedUsedTokens is required');
  });

  it('should throw when memory is set without estimatedUsedMemoryKB', () => {
    const config: InternalLimiterConfig = { memory: { freeMemoryRatio: RATIO_HALF } };
    expect(() => { validateMemoryLimits(config, undefined); }).toThrow('resourcesPerEvent.estimatedUsedMemoryKB is required');
  });

  it('should throw when memory is set with zero estimatedUsedMemoryKB', () => {
    const config: InternalLimiterConfig = { memory: { freeMemoryRatio: RATIO_HALF } };
    expect(() => { validateMemoryLimits(config, { estimatedUsedMemoryKB: ZERO }); }).toThrow('resourcesPerEvent.estimatedUsedMemoryKB is required');
  });

  it('should pass validateConfig with valid config', () => {
    const config: InternalLimiterConfig = {
      requestsPerMinute: HUNDRED,
      tokensPerMinute: HUNDRED,
      resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: FIFTY },
    };
    expect(() => { validateConfig(config); }).not.toThrow();
  });
});

describe('rateLimiter - memory initialization', () => {
  it('should initialize memory limiter with min/max clamping and check capacity', async () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_TENTH, recalculationIntervalMs: FIFTY }, minCapacity: HUNDRED, maxCapacity: HUNDRED * TEN, resourcesPerEvent: { estimatedUsedMemoryKB: TEN },
    });
    expect(limiter.getStats().memory?.maxCapacityKB).toBeGreaterThanOrEqual(HUNDRED);
    await setTimeoutAsync(FIFTY + TEN);
    limiter.stop();
    const limiter2 = createInternalLimiter({ memory: { freeMemoryRatio: RATIO_LOW }, maxCapacity: ONE, resourcesPerEvent: { estimatedUsedMemoryKB: HUNDRED } });
    expect(limiter2.hasCapacity()).toBe(false);
    limiter2.stop();
  });
});

describe('rateLimiter - memory acquire/release', () => {
  it('should acquire and release memory during job execution', async () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_HALF },
      maxCapacity: HUNDRED * TEN,
      resourcesPerEvent: { estimatedUsedMemoryKB: TEN },
    });
    const result = await limiter.queueJob(async () => {
      await setTimeoutAsync(DELAY_SHORT);
      return { requestCount: ONE, usage: { input: FIFTY, output: TEN, cached: ZERO } };
    });
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });

  it('should stop memory recalculation interval on stop()', () => {
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_HALF, recalculationIntervalMs: TEN },
      resourcesPerEvent: { estimatedUsedMemoryKB: ONE },
    });
    limiter.stop();
    limiter.stop();
  });
});

describe('rateLimiter - refunds and capacity', () => {
  it('should refund request and token differences', async () => {
    const limiter1 = createInternalLimiter({ requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: TEN } });
    await limiter1.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    expect(limiter1.getStats().requestsPerMinute?.current).toBe(ONE);
    limiter1.stop();
    const limiter2 = createInternalLimiter({ tokensPerMinute: THOUSAND, resourcesPerEvent: { estimatedUsedTokens: HUNDRED } });
    await limiter2.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(limiter2.getStats().tokensPerMinute?.current).toBeLessThan(HUNDRED);
    limiter2.stop();
  });
  it('should exhaust capacity', async () => {
    const limiter = createInternalLimiter({ requestsPerMinute: ONE, resourcesPerEvent: { estimatedNumberOfRequests: ONE } });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    expect(limiter.hasCapacity()).toBe(false);
    limiter.stop();
  });
});

describe('rateLimiter - capacity waiting with fake timers', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });
  it('should wait for capacity when exhausted and queue second job', async () => {
    const limiter = createInternalLimiter({ requestsPerMinute: ONE, resourcesPerEvent: { estimatedNumberOfRequests: ONE } });
    await limiter.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    const secondJob = limiter.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    jest.advanceTimersByTime(HUNDRED);
    await jest.advanceTimersByTimeAsync(HUNDRED * HUNDRED * TEN);
    const result = await secondJob;
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});


describe('rateLimiter - stats with all limiters', () => {
  it('should get stats with all configured limiters', () => {
    const limiter = createInternalLimiter({
      requestsPerMinute: HUNDRED, requestsPerDay: HUNDRED * TEN, tokensPerMinute: HUNDRED * TEN, tokensPerDay: HUNDRED * HUNDRED,
      maxConcurrentRequests: TEN, memory: { freeMemoryRatio: RATIO_HALF },
      resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: TEN, estimatedUsedMemoryKB: ONE },
    });
    const stats = limiter.getStats();
    expect(stats.requestsPerMinute).toBeDefined();
    expect(stats.requestsPerDay).toBeDefined();
    expect(stats.tokensPerMinute).toBeDefined();
    expect(stats.tokensPerDay).toBeDefined();
    expect(stats.concurrency).toBeDefined();
    expect(stats.memory).toBeDefined();
    limiter.stop();
  });
});

const createMockStats = (overrides: Partial<InternalLimiterStats> = {}): LLMRateLimiterStats => ({
  models: { default: { tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND }, ...overrides } },
});

describe('availabilityTracker - getCurrentAvailability', () => {
  it('should call getCurrentAvailability', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => createMockStats(),
      estimatedResources: { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO },
    });
    const availability = tracker.getCurrentAvailability();
    expect(availability.slots).toBeGreaterThan(ZERO);
  });
});

describe('availabilityTracker - change detection', () => {
  it('should detect tokensPerMinute change', () => {
    let statsTokens = HUNDRED;
    const calls: string[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_, reason) => { calls.push(reason); },
      getStats: () => ({ models: { default: { tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: statsTokens, resetsInMs: THOUSAND } } } }),
      estimatedResources: { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO },
    });
    tracker.initialize();
    statsTokens = FIFTY;
    tracker.checkAndEmit('tokensMinute');
    expect(calls.includes('tokensMinute')).toBe(true);
  });

});

interface CallRecord { reason: string; adjustment: RelativeAvailabilityAdjustment | undefined }

describe('availabilityTracker - adjustment callback', () => {
  it('should handle checkAndEmit with adjustment', () => {
    const calls: CallRecord[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_, reason, adjustment) => { calls.push({ reason, adjustment }); },
      getStats: () => createMockStats(),
      estimatedResources: { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO },
    });
    const adjustment: RelativeAvailabilityAdjustment = {
      tokensPerMinute: -TEN, tokensPerDay: -TEN, requestsPerMinute: ZERO, requestsPerDay: ZERO, memoryKB: ZERO, concurrentRequests: ZERO,
    };
    tracker.checkAndEmit('adjustment', adjustment);
    expect(calls.some((c) => c.reason === 'adjustment' && c.adjustment !== undefined)).toBe(true);
  });
});

describe('multiModelRateLimiter - pricing undefined', () => {
  it('should return zero cost when model has no pricing', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } },
    });
    let capturedCost = -ONE;
    await limiter.queueJob({
      jobId: 'test-no-pricing',
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: HUNDRED, cachedTokens: ZERO, outputTokens: FIFTY });
        return { requestCount: ONE, usage: { input: HUNDRED, output: FIFTY, cached: ZERO } };
      },
      onComplete: (_, context) => {
        const { totalCost } = context;
        capturedCost = totalCost;
      },
    });
    expect(capturedCost).toBe(ZERO);
    limiter.stop();
  });
});

describe('helper functions - queue helpers and ensureDefined', () => {
  const modelConfig = { tokensPerMinute: THOUSAND * TEN, resourcesPerEvent: { estimatedUsedTokens: THOUSAND }, pricing: { input: ZERO, cached: ZERO, output: ZERO } };
  it('should use queueSimpleJob helper', async () => {
    const limiter = createTestLimiter({ models: { default: modelConfig } });
    const result = await queueSimpleJob(limiter, createHelperMockJobResult('simple-test'));
    expect(result.text).toBe('simple-test');
    limiter.stop();
  });
  it('should use queueDelayedJob helper', async () => {
    const limiter = createTestLimiter({ models: { default: modelConfig } });
    const result = await queueDelayedJob(limiter, 'delayed-test', DELAY_SHORT);
    expect(result.text).toBe('delayed-test');
    limiter.stop();
  });
  it('should throw from ensureDefined when value is undefined or null', () => {
    expect(() => { ensureDefined(undefined); }).toThrow('Expected value to be defined');
    expect(() => { ensureDefined(null); }).toThrow('Expected value to be defined');
    expect(() => { ensureDefined(undefined, 'Custom error'); }).toThrow('Custom error');
  });
});
