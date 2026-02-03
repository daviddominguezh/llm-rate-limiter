import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { JobCallbackContext, LLMRateLimiterInstance, UsageEntryWithCost } from '../multiModelTypes.js';
import {
  ALT_PRICING,
  CHEAP_PRICING,
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  ONE,
  RPM_LIMIT_HIGH,
  THREE,
  TOKENS_1M,
  TWO,
  ZERO,
  createDefaultResourceEstimations,
  createMockJobResult,
  ensureDefined,
  generateJobId,
} from './multiModelRateLimiter.helpers.js';

const MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: DEFAULT_PRICING,
};
const CHEAP_MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: CHEAP_PRICING,
};
const ALT_MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: ALT_PRICING,
};

const getUsageAt = (ctx: JobCallbackContext, index: number): UsageEntryWithCost | undefined =>
  ctx.usage[index];

describe('MultiModelRateLimiter - pricing with delegation', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should accumulate costs correctly when delegating between different priced models', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': ALT_MODEL_CONFIG,
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => {
        const usage = { modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO };
        if (modelId === 'model-a') {
          reject(usage, { delegate: true });
        } else {
          resolve(usage);
        }
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const expectedTotalCost = DEFAULT_PRICING.input + ALT_PRICING.input;
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo(expectedTotalCost);
    const delegationFirst = getUsageAt(ctx, ZERO);
    const delegationSecond = getUsageAt(ctx, ONE);
    expect(delegationFirst?.cost).toBeCloseTo(DEFAULT_PRICING.input);
    expect(delegationSecond?.cost).toBeCloseTo(ALT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - cost in usage entries', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should include cost in each usage entry', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    const costEntry = getUsageAt(ctx, ZERO);
    expect(costEntry?.cost).toBeDefined();
    expect(costEntry?.cost).toBeCloseTo(DEFAULT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - cost per model after delegation', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should have cost property on each usage entry after delegation', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG, 'model-b': ALT_MODEL_CONFIG, 'model-c': CHEAP_MODEL_CONFIG },
      escalationOrder: ['model-a', 'model-b', 'model-c'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => {
        const usage = { modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO };
        if (modelId === 'model-c') {
          resolve(usage);
        } else {
          reject(usage, { delegate: true });
        }
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.usage).toHaveLength(THREE);
    const [usageFirst, usageSecond, usageThird] = [
      getUsageAt(ctx, ZERO),
      getUsageAt(ctx, ONE),
      getUsageAt(ctx, TWO),
    ];
    expect(usageFirst?.cost).toBeCloseTo(DEFAULT_PRICING.input);
    expect(usageSecond?.cost).toBeCloseTo(ALT_PRICING.input);
    expect(usageThird?.cost).toBeCloseTo(CHEAP_PRICING.input);
  });
});
