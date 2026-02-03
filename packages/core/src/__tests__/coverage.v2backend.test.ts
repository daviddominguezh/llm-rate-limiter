/**
 * Tests to achieve 100% coverage - V2 backend and memory edge cases.
 */
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { AllocationInfo } from '../multiModelTypes.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const HUNDRED = 100;
const THOUSAND = 1000;
const RATIO_HALF = 0.5;
const SHORT_DELAY = 10;

const ZERO_PRICING = { input: ZERO, cached: ZERO, output: ZERO };
const DEFAULT_ALLOCATION = { slots: TEN, tokensPerMinute: THOUSAND, requestsPerMinute: HUNDRED };

type SubscribeCallback = (alloc: AllocationInfo) => void;

interface V2BackendResult {
  registerCalls: string[];
  unregisterCalls: string[];
  subscribeCalls: string[];
  backend: {
    register: (id: string) => Promise<AllocationInfo>;
    unregister: (id: string) => Promise<void>;
    subscribe: (id: string, cb: SubscribeCallback) => () => void;
    acquire: () => Promise<boolean>;
    release: () => Promise<void>;
  };
}

const createV2Backend = (unregisterError = false): V2BackendResult => {
  const registerCalls: string[] = [];
  const unregisterCalls: string[] = [];
  const subscribeCalls: string[] = [];
  return {
    registerCalls,
    unregisterCalls,
    subscribeCalls,
    backend: {
      register: async (instanceId: string): Promise<AllocationInfo> => {
        registerCalls.push(instanceId);
        return await Promise.resolve(DEFAULT_ALLOCATION);
      },
      unregister: async (instanceId: string): Promise<void> => {
        unregisterCalls.push(instanceId);
        if (unregisterError) {
          await Promise.reject(new Error('unregister error'));
        }
        await Promise.resolve();
      },
      subscribe: (instanceId: string, _callback: SubscribeCallback): (() => void) => {
        subscribeCalls.push(instanceId);
        return () => {
          /* unsubscribe */
        };
      },
      acquire: async (): Promise<boolean> => await Promise.resolve(true),
      release: async (): Promise<void> => {
        await Promise.resolve();
      },
    },
  };
};

describe('multiModelRateLimiter - V2 backend register', () => {
  it('should register with V2 backend on start', async () => {
    const { backend, registerCalls, subscribeCalls } = createV2Backend();
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend,
    });
    await limiter.start();
    expect(registerCalls).toHaveLength(ONE);
    expect(subscribeCalls).toHaveLength(ONE);
    limiter.stop();
  });
});

describe('multiModelRateLimiter - V2 backend unregister', () => {
  it('should unregister from V2 backend on stop', async () => {
    const { backend, unregisterCalls } = createV2Backend();
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend,
    });
    await limiter.start();
    limiter.stop();
    await setTimeoutAsync(SHORT_DELAY);
    expect(unregisterCalls).toHaveLength(ONE);
  });
});

describe('multiModelRateLimiter - V2 backend unregister error', () => {
  it('should handle V2 backend unregister errors silently', async () => {
    const { backend } = createV2Backend(true);
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend,
    });
    await limiter.start();
    expect(() => {
      limiter.stop();
    }).not.toThrow();
    await setTimeoutAsync(SHORT_DELAY);
  });
});

describe('multiModelRateLimiter - start without backend', () => {
  it('should do nothing on start when no backend', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    limiter.stop();
  });
});

describe('multiModelRateLimiter - start with minimal V2 backend', () => {
  it('should handle minimal V2 backend on start', async () => {
    const minimalV2Backend = {
      register: async (_instanceId: string): Promise<AllocationInfo> =>
        await Promise.resolve(DEFAULT_ALLOCATION),
      unregister: async (): Promise<void> => {
        await Promise.resolve();
      },
      subscribe: (): (() => void) => () => {
        /* no-op */
      },
      acquire: async (): Promise<boolean> => await Promise.resolve(true),
      release: async (): Promise<void> => {
        await Promise.resolve();
      },
    };
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend: minimalV2Backend,
    });
    await limiter.start();
    limiter.stop();
  });
});

describe('memoryManager - zero memory model acquire/release', () => {
  it('should skip acquire/release for model without estimatedUsedMemoryKB', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        'model-no-mem': {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
        'model-with-mem': {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        default: { estimatedNumberOfRequests: ONE },
        'with-memory': { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ONE },
      },
      memory: { freeMemoryRatio: RATIO_HALF },
      escalationOrder: ['model-no-mem', 'model-with-mem'],
    });
    const result = await limiter.queueJob({
      jobId: 'test-no-mem',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    expect(result.modelUsed).toBe('model-no-mem');
    limiter.stop();
  });
});

describe('multiModelRateLimiter - getInstanceId', () => {
  it('should return unique instance ID', () => {
    const limiter1 = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    const limiter2 = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter1.getInstanceId()).not.toBe(limiter2.getInstanceId());
    expect(limiter1.getInstanceId().startsWith('inst-')).toBe(true);
    limiter1.stop();
    limiter2.stop();
  });
});

describe('backendHelpers - V2 backend release error', () => {
  it('should handle V2 backend release errors silently', async () => {
    const v2BackendWithReleaseError = {
      register: async (_instanceId: string): Promise<AllocationInfo> =>
        await Promise.resolve({ ...DEFAULT_ALLOCATION }),
      unregister: async (): Promise<void> => {
        await Promise.resolve();
      },
      subscribe: (): (() => void) => () => {
        /* no-op */
      },
      acquire: async (): Promise<boolean> => await Promise.resolve(true),
      release: async (): Promise<void> => {
        await Promise.reject(new Error('V2 release error'));
      },
    };
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      backend: v2BackendWithReleaseError,
    });
    await limiter.start();
    const result = await limiter.queueJob({
      jobId: 'test-v2-release-error',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    expect(result.requestCount).toBe(ONE);
    await setTimeoutAsync(SHORT_DELAY);
    limiter.stop();
  });
});
