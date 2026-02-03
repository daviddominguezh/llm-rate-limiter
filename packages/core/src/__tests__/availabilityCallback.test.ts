/**
 * Tests for onAvailableSlotsChange callback functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type {
  Availability,
  AvailabilityChangeReason,
  LLMRateLimiterInstance,
  RelativeAvailabilityAdjustment,
} from '../multiModelTypes.js';
import { setTimeoutAsync } from './limiterCombinations.helpers.js';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const HUNDRED = 100;
const ESTIMATED_TOKENS = 1000;
const ESTIMATED_MEMORY_KB = 100;
const FREE_MEMORY_RATIO = 0.8;

const ZERO_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

interface CallbackRecord {
  availability: Availability;
  reason: AvailabilityChangeReason;
  modelId: string;
  adjustment?: RelativeAvailabilityAdjustment;
}

const createMockUsage = (
  modelId: string,
  inputTokens = ESTIMATED_TOKENS,
  outputTokens = ZERO
): {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
} => ({ modelId, inputTokens, cachedTokens: ZERO, outputTokens });

const defaultModelConfig = {
  tokensPerMinute: ESTIMATED_TOKENS * TEN,
  pricing: ZERO_PRICING,
};

const defaultJobType = {
  estimatedUsedTokens: ESTIMATED_TOKENS,
  estimatedNumberOfRequests: ONE,
};

const createCallbackLimiter = (calls: CallbackRecord[]): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    models: { default: defaultModelConfig },
    resourceEstimationsPerJob: { default: defaultJobType } as Record<string, typeof defaultJobType>,
    onAvailableSlotsChange: (availability, reason, modelId, adjustment) => {
      calls.push({ availability, reason, modelId, adjustment });
    },
  });

type LimiterConfig = Parameters<typeof createLLMRateLimiter>[typeof ZERO];

const createMemoryLimiterConfig = (calls: CallbackRecord[]): LimiterConfig => ({
  memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
  models: { default: { ...defaultModelConfig, maxCapacity: ESTIMATED_MEMORY_KB * TEN } },
  resourceEstimationsPerJob: {
    default: {
      estimatedUsedTokens: ESTIMATED_TOKENS,
      estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
    },
  },
  onAvailableSlotsChange: (availability, reason, modelId, adjustment) => {
    calls.push({ availability, reason, modelId, adjustment });
  },
});

const createSimpleJobForModel =
  (tokens: number) =>
  (
    { modelId }: { modelId: string },
    resolve: (r: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
  ): { usage: { input: number; output: number; cached: number }; requestCount: number } => {
    resolve(createMockUsage(modelId, tokens));
    return { usage: { input: tokens, output: ZERO, cached: ZERO }, requestCount: ONE };
  };

const createAsyncJobForModel =
  (tokens: number, delayMs: number) =>
  async (
    { modelId }: { modelId: string },
    resolve: (r: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
  ): Promise<{ usage: { input: number; output: number; cached: number }; requestCount: number }> => {
    await setTimeoutAsync(delayMs);
    resolve(createMockUsage(modelId, tokens));
    return { usage: { input: tokens, output: ZERO, cached: ZERO }, requestCount: ONE };
  };

describe('onAvailableSlotsChange callback - token adjustments', () => {
  it('should call callback with adjustment reason when actual tokens differ from estimated', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createCallbackLimiter(calls);
    const actualTokens = ESTIMATED_TOKENS + HUNDRED;
    await limiter.queueJob({
      jobId: 'test-1',
      jobType: 'default',
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId, actualTokens));
        return { usage: { input: actualTokens, output: ZERO, cached: ZERO }, requestCount: ONE };
      },
    });
    const adjustmentCall = calls.find((c) => c.reason === 'adjustment');
    expect(adjustmentCall).toBeDefined();
    expect(adjustmentCall?.adjustment).toBeDefined();
    expect(adjustmentCall?.adjustment?.tokensPerMinute).toBe(HUNDRED);
    expect(adjustmentCall?.adjustment?.tokensPerDay).toBe(HUNDRED);
    limiter.stop();
  });

  it('should not call adjustment callback when actual equals estimated', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createCallbackLimiter(calls);
    await limiter.queueJob({
      jobId: 'test-1',
      jobType: 'default',
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return { usage: { input: ESTIMATED_TOKENS, output: ZERO, cached: ZERO }, requestCount: ONE };
      },
    });
    const adjustmentCalls = calls.filter((c) => c.reason === 'adjustment');
    expect(adjustmentCalls.length).toBe(ZERO);
    limiter.stop();
  });
});

describe('onAvailableSlotsChange callback - memory', () => {
  it('should call callback on memory acquire with memory reason', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createLLMRateLimiter(createMemoryLimiterConfig(calls));
    const jobPromise = limiter.queueJob({
      jobId: 'test-1',
      jobType: 'default',
      job: createAsyncJobForModel(ESTIMATED_TOKENS, TEN),
    });
    await setTimeoutAsync(ONE);
    const memoryCall = calls.find((c) => c.reason === 'memory');
    expect(memoryCall).toBeDefined();
    expect(memoryCall?.availability.memoryKB).not.toBeNull();
    await jobPromise;
    limiter.stop();
  });
});

describe('onAvailableSlotsChange callback - optional', () => {
  it('should work without callback (optional)', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { tokensPerMinute: ESTIMATED_TOKENS * TEN, pricing: ZERO_PRICING } },
      resourceEstimationsPerJob: { default: defaultJobType },
    });
    await expect(
      limiter.queueJob({
        jobId: 'test-1',
        jobType: 'default',
        job: createSimpleJobForModel(ESTIMATED_TOKENS),
      })
    ).resolves.toBeDefined();
    limiter.stop();
  });
});

describe('onAvailableSlotsChange callback - multi-model', () => {
  it('should handle multi-model configuration', async () => {
    const calls: CallbackRecord[] = [];
    const modelConfig = { tokensPerMinute: ESTIMATED_TOKENS * TEN, pricing: ZERO_PRICING };
    const limiter = createLLMRateLimiter({
      models: { modelA: modelConfig, modelB: modelConfig },
      escalationOrder: ['modelA', 'modelB'],
      resourceEstimationsPerJob: {
        default: { estimatedUsedTokens: ESTIMATED_TOKENS, estimatedNumberOfRequests: ONE },
      },
      onAvailableSlotsChange: (availability, reason, modelId, adjustment) => {
        calls.push({ availability, reason, modelId, adjustment });
      },
    });
    const actualTokens = ESTIMATED_TOKENS + HUNDRED;
    await limiter.queueJob({
      jobId: 'test-1',
      jobType: 'default',
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId, actualTokens));
        return { usage: { input: actualTokens, output: ZERO, cached: ZERO }, requestCount: ONE };
      },
    });
    const adjustmentCall = calls.find((c) => c.reason === 'adjustment');
    expect(adjustmentCall).toBeDefined();
    expect(adjustmentCall?.availability.slots).toBeGreaterThan(ZERO);
    limiter.stop();
  });
});

describe('onAvailableSlotsChange callback - availability', () => {
  it('should report null for unconfigured limiters in availability', async () => {
    const calls: CallbackRecord[] = [];
    const limiter = createCallbackLimiter(calls);
    const actualTokens = ESTIMATED_TOKENS + HUNDRED;
    await limiter.queueJob({
      jobId: 'test-1',
      jobType: 'default',
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId, actualTokens));
        return { usage: { input: actualTokens, output: ZERO, cached: ZERO }, requestCount: ONE };
      },
    });
    expect(calls.length).toBeGreaterThan(ZERO);
    const lastCall = calls.at(-ONE);
    expect(lastCall).toBeDefined();
    expect(lastCall?.availability.tokensPerDay).toBeNull();
    expect(lastCall?.availability.requestsPerMinute).toBeNull();
    expect(lastCall?.availability.requestsPerDay).toBeNull();
    expect(lastCall?.availability.memoryKB).toBeNull();
    limiter.stop();
  });
});
