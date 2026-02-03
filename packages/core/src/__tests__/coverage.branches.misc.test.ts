/**
 * Branch coverage tests for rateLimiter, backend, and misc utilities.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import { createInternalLimiter } from '../rateLimiter.js';
import { buildJobArgs } from '../utils/jobExecutionHelpers.js';
import { createMemoryManager } from '../utils/memoryManager.js';
import { HUNDRED, ONE, RATIO_HALF, TEN, THOUSAND, ZERO } from './coverage.branches.helpers.js';
import { createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

describe('rateLimiter - daily counter refunds', () => {
  it('should refund to daily counters', async () => {
    const limiter1 = createInternalLimiter({ requestsPerDay: HUNDRED });
    await limiter1.queueJob(() => ({
      requestCount: ONE,
      usage: { input: ZERO, output: ZERO, cached: ZERO },
    }));
    expect(limiter1.getStats().requestsPerDay?.current).toBe(ONE);
    limiter1.stop();
    const limiter2 = createInternalLimiter({ tokensPerDay: THOUSAND });
    await limiter2.queueJob(() => ({ requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } }));
    expect(limiter2.getStats().tokensPerDay?.current).toBe(TEN + TEN);
    limiter2.stop();
  });
});

describe('rateLimiter - default freeMemoryRatio', () => {
  it('should use default freeMemoryRatio when not specified in memory config', () => {
    const limiter = createInternalLimiter({ memory: {} });
    expect(limiter.getStats().memory?.maxCapacityKB).toBeGreaterThan(ZERO);
    limiter.stop();
  });
});

describe('multiModelRateLimiter - V1 backend start', () => {
  it('should be no-op when calling start with no backend', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: TEN, pricing: { input: ZERO, cached: ZERO, output: ZERO } } },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    expect(limiter.getInstanceId()).toBeDefined();
    limiter.stop();
  });

  it('should be no-op when calling start with V2 backend', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: TEN, pricing: { input: ZERO, cached: ZERO, output: ZERO } } },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend: {
        register: async () =>
          await Promise.resolve({ slots: TEN, tokensPerMinute: THOUSAND, requestsPerMinute: HUNDRED }),
        unregister: async () => {
          await Promise.resolve();
        },
        subscribe: () => () => {
          /* unsubscribe */
        },
        acquire: async () => await Promise.resolve(true),
        release: async () => {
          await Promise.resolve();
        },
      },
    });
    await limiter.start();
    expect(limiter.getInstanceId()).toBeDefined();
    limiter.stop();
  });
});

describe('jobExecutionHelpers - buildJobArgs', () => {
  it('should merge modelId with provided args', () => {
    const args = { prompt: 'test', temperature: RATIO_HALF };
    const result = buildJobArgs('gpt-4', args);
    expect(result.modelId).toBe('gpt-4');
    expect(result.prompt).toBe('test');
  });
});

describe('memoryManager - configuration branches', () => {
  it('should use default freeMemoryRatio when not specified', () => {
    const manager = createMemoryManager({
      config: {
        models: { default: { pricing: { input: ONE, output: ONE, cached: ONE } } },
        memory: {},
        resourceEstimationsPerJob: createDefaultResourceEstimations(),
      },
      label: 'test',
      estimatedUsedMemoryKB: TEN,
    });
    expect(manager).not.toBeNull();
    expect(manager?.getStats()?.maxCapacityKB).toBeGreaterThan(ZERO);
    manager?.stop();
  });

  it('should handle models without memory estimation', () => {
    const manager = createMemoryManager({
      config: {
        models: {
          withMemory: { pricing: { input: ONE, output: ONE, cached: ONE } },
          withoutMemory: { pricing: { input: ONE, output: ONE, cached: ONE } },
        },
        memory: {},
        resourceEstimationsPerJob: createDefaultResourceEstimations(),
        escalationOrder: ['withMemory', 'withoutMemory'],
      },
      label: 'test',
      estimatedUsedMemoryKB: TEN,
    });
    expect(manager?.hasCapacity('withMemory')).toBe(true);
    expect(manager?.hasCapacity('withoutMemory')).toBe(true);
    manager?.stop();
  });
});
