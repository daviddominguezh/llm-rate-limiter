import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { JobCallbackContext, LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  CHEAP_PRICING,
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  EXPENSIVE_PRICING,
  RPM_LIMIT_HIGH,
  TEN,
  TOKENS_1M,
  TOKENS_100K,
  ZERO,
  ZERO_CACHED_TOKENS,
  createDefaultResourceEstimations,
  createMockJobResult,
  ensureDefined,
  generateJobId,
} from './multiModelRateLimiter.helpers.js';

type DefaultJobType = typeof DEFAULT_JOB_TYPE;

const MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: DEFAULT_PRICING,
};
const CHEAP_MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: CHEAP_PRICING,
};
const EXPENSIVE_MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: EXPENSIVE_PRICING,
};

describe('MultiModelRateLimiter - pricing input tokens', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost correctly for 1M input tokens', async () => {
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
    expect(ctx.totalCost).toBeCloseTo(DEFAULT_PRICING.input);
  });
});

describe('MultiModelRateLimiter - pricing output tokens', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost correctly for 1M output tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: TOKENS_1M, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo(DEFAULT_PRICING.output);
  });
});

describe('MultiModelRateLimiter - pricing cached tokens', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost correctly for 1M cached tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: ZERO, cachedTokens: TOKENS_1M });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo(DEFAULT_PRICING.cached);
  });
});

describe('MultiModelRateLimiter - pricing combined tokens', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost correctly for combined tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TOKENS_1M, outputTokens: TOKENS_1M, cachedTokens: TOKENS_1M });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const expectedCost = DEFAULT_PRICING.input + DEFAULT_PRICING.output + DEFAULT_PRICING.cached;
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo(expectedCost);
  });
});

describe('MultiModelRateLimiter - pricing fractional 100K', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost correctly for 100K tokens (1/10 of 1M)', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({
          modelId,
          inputTokens: TOKENS_100K,
          outputTokens: TOKENS_100K,
          cachedTokens: ZERO_CACHED_TOKENS,
        });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo((DEFAULT_PRICING.input + DEFAULT_PRICING.output) / TEN);
  });
});

describe('MultiModelRateLimiter - pricing zero tokens', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate zero cost for zero tokens', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, outputTokens: ZERO, cachedTokens: ZERO });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBe(ZERO);
  });
});

describe('MultiModelRateLimiter - pricing different models', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should calculate cost using correct model pricing', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'cheap-model': CHEAP_MODEL_CONFIG,
        'expensive-model': EXPENSIVE_MODEL_CONFIG,
      },
      escalationOrder: ['cheap-model', 'expensive-model'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({
          modelId,
          inputTokens: TOKENS_1M,
          outputTokens: TOKENS_1M,
          cachedTokens: ZERO_CACHED_TOKENS,
        });
        return createMockJobResult('test');
      },
      onComplete: (_result, ctx) => {
        capturedCtx = ctx;
      },
    });
    const expectedCheap = CHEAP_PRICING.input + CHEAP_PRICING.output;
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeCloseTo(expectedCheap);
  });
});
