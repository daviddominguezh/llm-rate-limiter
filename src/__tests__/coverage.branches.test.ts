/**
 * Additional branch coverage tests.
 */
import { AvailabilityTracker } from '../utils/availabilityTracker.js';
import { buildJobArgs } from '../utils/jobExecutionHelpers.js';
import { createMemoryManager } from '../utils/memoryManager.js';
import { createInternalLimiter } from '../rateLimiter.js';
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterStats } from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const FIFTY = 50;
const HUNDRED = 100;
const THOUSAND = 1000;
const RATIO_HALF = 0.5;

/** Config type for testing internal access */
interface TestableConfig { models: Record<string, { pricing?: unknown }> }

describe('multiModelRateLimiter - calculateCost with undefined pricing', () => {
  it('should return zero cost when pricing is undefined', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ONE, cached: ONE, output: ONE } } } });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Testing defensive code path for undefined pricing
    const { models } = Reflect.get(limiter, 'config') as TestableConfig;
    const { default: defaultModel } = models;
    if (defaultModel !== undefined) { delete defaultModel.pricing; }
    let capturedCost = -ONE;
    await limiter.queueJob({ jobId: 'no-pricing', job: ({ modelId }, resolve) => { resolve({ modelId, inputTokens: HUNDRED, cachedTokens: ZERO, outputTokens: FIFTY }); return { requestCount: ONE, usage: { input: HUNDRED, output: FIFTY, cached: ZERO } }; }, onComplete: (_, { totalCost }) => { capturedCost = totalCost; } });
    expect(capturedCost).toBe(ZERO);
    limiter.stop();
  });
});


describe('multiModelRateLimiter - error and queueJobForModel', () => {
  it('should call onError when job throws', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } } });
    const errors: Error[] = [];
    const jobPromise = limiter.queueJob({ jobId: 'error-test', job: (_, resolve) => { resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }); throw new Error('Test error'); }, onError: (err) => { errors.push(err); } });
    await expect(jobPromise).rejects.toThrow('Test error');
    expect(errors[ZERO]?.message).toBe('Test error');
    limiter.stop();
  });
  it('should throw when job does not call resolve or reject', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } } });
    const jobPromise = limiter.queueJob({ jobId: 'no-callback', job: () => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }) });
    await expect(jobPromise).rejects.toThrow('Job must call resolve() or reject()');
    limiter.stop();
  });
  it('should wrap non-Error throws in Error object for onError callback', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } } });
    const errors: Error[] = [];
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Testing defensive code that handles non-Error throws
    const jobPromise = limiter.queueJob({ jobId: 'string-error', job: (_, resolve) => { resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }); throw 'string error'; }, onError: (err) => { errors.push(err); } });
    await expect(jobPromise).rejects.toBe('string error');
    expect(errors[ZERO]?.message).toBe('string error');
    limiter.stop();
  });
  it('should queue job for specific model without memory manager', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } } });
    const result = await limiter.queueJobForModel('default', () => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
  it('should queue job for specific model with memory manager', async () => {
    const limiter = createLLMRateLimiter({ models: { default: { requestsPerMinute: TEN, resourcesPerEvent: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ONE }, pricing: { input: ZERO, cached: ZERO, output: ZERO } } }, memory: { freeMemoryRatio: RATIO_HALF } });
    const result = await limiter.queueJobForModel('default', () => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('rateLimiter - daily counter refunds', () => {
  it('should refund to daily counters', async () => {
    const limiter1 = createInternalLimiter({ requestsPerDay: HUNDRED, resourcesPerEvent: { estimatedNumberOfRequests: TEN } });
    await limiter1.queueJob(() => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }));
    expect(limiter1.getStats().requestsPerDay?.current).toBe(ONE);
    limiter1.stop();
    const limiter2 = createInternalLimiter({ tokensPerDay: THOUSAND, resourcesPerEvent: { estimatedUsedTokens: HUNDRED } });
    await limiter2.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(limiter2.getStats().tokensPerDay?.current).toBe(TEN + TEN);
    limiter2.stop();
  });
});

describe('rateLimiter - default freeMemoryRatio', () => {
  it('should use default freeMemoryRatio when not specified in memory config', () => {
    const limiter = createInternalLimiter({ memory: {}, resourcesPerEvent: { estimatedUsedMemoryKB: ONE } });
    expect(limiter.getStats().memory?.maxCapacityKB).toBeGreaterThan(ZERO);
    limiter.stop();
  });
});

describe('availabilityTracker - edge cases', () => {
  it('should handle null values and zero divisors in slot calculation', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => ({ models: { default: {} } }),
      estimatedResources: { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: ZERO },
    });
    const availability = tracker.getCurrentAvailability();
    expect(availability.slots).toBe(Number.POSITIVE_INFINITY);
  });
  it('should return from checkAndEmit when callback is undefined', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => ({ models: { default: { tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND } } } }),
      estimatedResources: { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO },
    });
    tracker.checkAndEmit('tokensMinute');
    expect(tracker.getCurrentAvailability().slots).toBeGreaterThan(ZERO);
  });
  it('should use hintReason when previousAvailability is null', () => {
    const calls: string[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_, reason) => { calls.push(reason); },
      getStats: () => ({ models: { default: { tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND } } } }),
      estimatedResources: { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO },
    });
    tracker.checkAndEmit('tokensMinute');
    expect(calls[ZERO]).toBe('tokensMinute');
  });
  it('should return from emitAdjustment when callback is undefined', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => ({ models: { default: {} } }),
      estimatedResources: { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: ZERO },
    });
    tracker.emitAdjustment({ tokensPerMinute: ZERO, tokensPerDay: ZERO, requestsPerMinute: ZERO, requestsPerDay: ZERO, memoryKB: ZERO, concurrentRequests: ZERO });
    expect(tracker.getCurrentAvailability().slots).toBe(Number.POSITIVE_INFINITY);
  });
});

interface TrackerResult { tracker: AvailabilityTracker; calls: string[] }
interface EstResources { estimatedUsedTokens: number; estimatedNumberOfRequests: number; estimatedUsedMemoryKB: number }
const createChangeTracker = (getStats: () => LLMRateLimiterStats, estimated: EstResources): TrackerResult => {
  const calls: string[] = [];
  const tracker = new AvailabilityTracker({ callback: (_, reason) => { calls.push(reason); }, getStats, estimatedResources: estimated });
  return { tracker, calls };
};

describe('availabilityTracker - all change reasons', () => {
  it('should detect tokensPerDay/requestsMinute/requestsDay changes', () => {
    let tokensDay = HUNDRED; let reqMin = HUNDRED; let reqDay = HUNDRED;
    const { tracker: t1, calls: c1 } = createChangeTracker(() => ({ models: { default: { tokensPerDay: { current: ZERO, limit: HUNDRED, remaining: tokensDay, resetsInMs: THOUSAND } } } }), { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO });
    t1.initialize(); tokensDay = FIFTY; t1.checkAndEmit('tokensDay'); expect(c1.includes('tokensDay')).toBe(true);
    const { tracker: t2, calls: c2 } = createChangeTracker(() => ({ models: { default: { requestsPerMinute: { current: ZERO, limit: HUNDRED, remaining: reqMin, resetsInMs: THOUSAND } } } }), { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO });
    t2.initialize(); reqMin = FIFTY; t2.checkAndEmit('requestsMinute'); expect(c2.includes('requestsMinute')).toBe(true);
    const { tracker: t3, calls: c3 } = createChangeTracker(() => ({ models: { default: { requestsPerDay: { current: ZERO, limit: HUNDRED, remaining: reqDay, resetsInMs: THOUSAND } } } }), { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO });
    t3.initialize(); reqDay = FIFTY; t3.checkAndEmit('requestsDay'); expect(c3.includes('requestsDay')).toBe(true);
  });
  it('should detect concurrentRequests/memory changes and skip equal', () => {
    let conc = TEN; let memKB = THOUSAND;
    const { tracker: t1, calls: c1 } = createChangeTracker(() => ({ models: { default: { concurrency: { active: ZERO, limit: TEN, available: conc, waiting: ZERO } } } }), { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: ZERO });
    t1.initialize(); conc = FIFTY; t1.checkAndEmit('concurrentRequests'); expect(c1.includes('concurrentRequests')).toBe(true);
    const { tracker: t2, calls: c2 } = createChangeTracker(() => ({ models: { default: {} }, memory: { activeKB: ZERO, maxCapacityKB: THOUSAND, availableKB: memKB, systemAvailableKB: THOUSAND } }), { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: TEN });
    t2.initialize(); memKB = HUNDRED; t2.checkAndEmit('memory'); expect(c2.includes('memory')).toBe(true);
    const { tracker: t3, calls: c3 } = createChangeTracker(() => ({ models: { default: { tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND } } } }), { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO });
    t3.initialize(); t3.checkAndEmit('tokensMinute'); expect(c3.length).toBe(ZERO);
  });
});

describe('jobExecutionHelpers and memoryManager branches', () => {
  it('should merge modelId with provided args', () => {
    const args = { prompt: 'test', temperature: RATIO_HALF };
    const result = buildJobArgs('gpt-4', args);
    expect(result.modelId).toBe('gpt-4');
    expect(result.prompt).toBe('test');
  });
  it('should use default freeMemoryRatio when not specified', () => {
    const manager = createMemoryManager({
      config: { models: { default: { pricing: { input: ONE, output: ONE, cached: ONE }, resourcesPerEvent: { estimatedUsedMemoryKB: TEN } } }, memory: {} },
      label: 'test', estimatedUsedMemoryKB: TEN,
    });
    expect(manager).not.toBeNull();
    expect(manager?.getStats()?.maxCapacityKB).toBeGreaterThan(ZERO);
    manager?.stop();
  });
  it('should handle model without estimatedUsedMemoryKB', () => {
    const manager = createMemoryManager({
      config: {
        models: { withMemory: { pricing: { input: ONE, output: ONE, cached: ONE }, resourcesPerEvent: { estimatedUsedMemoryKB: TEN } }, withoutMemory: { pricing: { input: ONE, output: ONE, cached: ONE } } },
        memory: {},
      },
      label: 'test', estimatedUsedMemoryKB: TEN,
    });
    expect(manager?.hasCapacity('withMemory')).toBe(true);
    expect(manager?.hasCapacity('withoutMemory')).toBe(true);
    manager?.stop();
  });
});
