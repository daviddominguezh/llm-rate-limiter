import { createLLMRateLimiter } from '../multiModelRateLimiter.js';

import type { JobCallbackContext, LLMRateLimiterInstance, UsageEntryWithCost } from '../multiModelTypes.js';
import { ALT_PRICING, CHEAP_PRICING, DEFAULT_PRICING, EXPENSIVE_PRICING, generateJobId, createMockJobResult, RPM_LIMIT_HIGH, TEN, TOKENS_100K, TOKENS_1M, ZERO, ZERO_CACHED_TOKENS, THREE, ONE, TWO } from './multiModelRateLimiter.helpers.js';

const MODEL_CONFIG = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };
const CHEAP_MODEL_CONFIG = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: CHEAP_PRICING };
const EXPENSIVE_MODEL_CONFIG = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: EXPENSIVE_PRICING };
const ALT_MODEL_CONFIG = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: ALT_PRICING };

const getUsageAt = (ctx: JobCallbackContext | undefined, index: number): UsageEntryWithCost | undefined => ctx?.usage[index];

describe('MultiModelRateLimiter - pricing input tokens', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost correctly for 1M input tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx?.totalCost).toBeCloseTo(DEFAULT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - pricing output tokens', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost correctly for 1M output tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: TOKENS_1M, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx?.totalCost).toBeCloseTo(DEFAULT_PRICING.output);
  });
});

describe('MultiModelRateLimiter - pricing cached tokens', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost correctly for 1M cached tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: ZERO, cachedTokens: TOKENS_1M });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx?.totalCost).toBeCloseTo(DEFAULT_PRICING.cached);
  });
});

describe('MultiModelRateLimiter - pricing combined tokens', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost correctly for combined tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: TOKENS_1M, cachedTokens: TOKENS_1M });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const expectedCost = DEFAULT_PRICING.input + DEFAULT_PRICING.output + DEFAULT_PRICING.cached;
    expect(capturedCtx?.totalCost).toBeCloseTo(expectedCost);
  });
});

describe('MultiModelRateLimiter - pricing fractional', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost correctly for 100K tokens (1/10 of 1M)', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_100K, outputTokens: TOKENS_100K, cachedTokens: ZERO_CACHED_TOKENS });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const expectedCost = (DEFAULT_PRICING.input + DEFAULT_PRICING.output) / TEN;
    expect(capturedCtx?.totalCost).toBeCloseTo(expectedCost);
  });

  it('should calculate zero cost for zero tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: ZERO, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx?.totalCost).toBe(ZERO);
  });
});

describe('MultiModelRateLimiter - pricing different models', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should calculate cost using correct model pricing', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'cheap-model': CHEAP_MODEL_CONFIG,
        'expensive-model': EXPENSIVE_MODEL_CONFIG,
      },
      order: ['cheap-model', 'expensive-model'],
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: TOKENS_1M, cachedTokens: ZERO_CACHED_TOKENS });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const expectedCheap = CHEAP_PRICING.input + CHEAP_PRICING.output;
    expect(capturedCtx?.totalCost).toBeCloseTo(expectedCheap);
  });
});

describe('MultiModelRateLimiter - pricing with delegation', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should accumulate costs correctly when delegating between different priced models', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': ALT_MODEL_CONFIG,
      },
      order: ['model-a', 'model-b'],
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        const usage = { modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO };
        if (modelId === 'model-a') { reject(usage, { delegate: true }); }
        else { resolve(usage); }
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const expectedTotalCost = DEFAULT_PRICING.input + ALT_PRICING.input;
    expect(capturedCtx?.totalCost).toBeCloseTo(expectedTotalCost);
    const delegationFirst = getUsageAt(capturedCtx, ZERO);
    const delegationSecond = getUsageAt(capturedCtx, ONE);
    expect(delegationFirst?.cost).toBeCloseTo(DEFAULT_PRICING.input);
    expect(delegationSecond?.cost).toBeCloseTo(ALT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - cost in usage entries', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should include cost in each usage entry', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const costEntry = getUsageAt(capturedCtx, ZERO);
    expect(costEntry?.cost).toBeDefined();
    expect(costEntry?.cost).toBeCloseTo(DEFAULT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - cost per model after delegation', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should have cost property on each usage entry after delegation', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': ALT_MODEL_CONFIG,
        'model-c': CHEAP_MODEL_CONFIG,
      },
      order: ['model-a', 'model-b', 'model-c'],
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve, reject) => {
        const usage = { modelId, inputTokens: TOKENS_1M, outputTokens: ZERO, cachedTokens: ZERO };
        if (modelId === 'model-c') { resolve(usage); }
        else { reject(usage, { delegate: true }); }
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    expect(capturedCtx?.usage).toHaveLength(THREE);
    const usageFirst = getUsageAt(capturedCtx, ZERO);
    const usageSecond = getUsageAt(capturedCtx, ONE);
    const usageThird = getUsageAt(capturedCtx, TWO);
    expect(usageFirst?.cost).toBeCloseTo(DEFAULT_PRICING.input);
    expect(usageSecond?.cost).toBeCloseTo(ALT_PRICING.input);
    expect(usageThird?.cost).toBeCloseTo(CHEAP_PRICING.input);
  });
});
