import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { JobCallbackContext, LLMRateLimiterInstance, UsageEntryWithCost } from '../multiModelTypes.js';
import {
  DEFAULT_PRICING,
  DELAY_MS_LONG,
  DELAY_MS_SHORT,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
  ONE,
  RPM_LIMIT_HIGH,
  ZERO,
  createMockJobResult,
  createMockUsage,
  ensureDefined,
  generateJobId,
} from './multiModelRateLimiter.helpers.js';

const MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  resourcesPerEvent: { estimatedNumberOfRequests: ONE },
  pricing: DEFAULT_PRICING,
};

const getUsageAt = (ctx: JobCallbackContext | undefined, index: number): UsageEntryWithCost | undefined =>
  ctx?.usage[index];

describe('MultiModelRateLimiter - onComplete callback basic', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should call onComplete with proper jobId and usage when job resolves', async () => {
    limiter = createLLMRateLimiter({ models: { 'model-a': MODEL_CONFIG } });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await limiter.queueJob({
      jobId: testJobId,
      job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('test'); },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    const firstUsage = getUsageAt(capturedCtx, ZERO);
    expect(firstUsage?.modelId).toBe('model-a');
    expect(firstUsage?.inputTokens).toBe(MOCK_INPUT_TOKENS);
    expect(firstUsage?.outputTokens).toBe(MOCK_OUTPUT_TOKENS);
  });
  it('should include totalCost in onComplete callback', async () => {
    limiter = createLLMRateLimiter({ models: { 'model-a': MODEL_CONFIG } });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('test'); },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeDefined();
    expect(typeof ctx.totalCost).toBe('number');
  });
});

describe('MultiModelRateLimiter - onComplete callback skipping', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should call onComplete with usage only for the model that processed when skipping', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING }, 'model-b': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING } },
      order: ['model-a', 'model-b'],
    });
    const blockingJobPromise = limiter.queueJob({
      jobId: generateJobId(),
      job: async ({ modelId }, resolve) => { await setTimeoutAsync(DELAY_MS_LONG); resolve(createMockUsage(modelId)); return createMockJobResult('blocking'); },
    });
    await setTimeoutAsync(DELAY_MS_SHORT);
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    const secondJobPromise = limiter.queueJob({
      jobId: testJobId,
      job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('second'); },
      onComplete: (_result, ctx) => { capturedCtx = ctx; },
    });
    await secondJobPromise;
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    expect(getUsageAt(ctx, ZERO)?.modelId).toBe('model-b');
    await blockingJobPromise;
  });
});

describe('MultiModelRateLimiter - onError callback basic', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should call onError with proper jobId and usage when job rejects without delegation', async () => {
    limiter = createLLMRateLimiter({ models: { 'model-a': MODEL_CONFIG } });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await expect(
      limiter.queueJob({
        jobId: testJobId,
        job: ({ modelId }, _resolve, reject) => { reject(createMockUsage(modelId), { delegate: false }); return createMockJobResult('test'); },
        onError: (_error, ctx) => { capturedCtx = ctx; },
      })
    ).rejects.toThrow();
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    expect(getUsageAt(ctx, ZERO)?.modelId).toBe('model-a');
  });
  it('should include totalCost in onError callback', async () => {
    limiter = createLLMRateLimiter({ models: { 'model-a': MODEL_CONFIG } });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await expect(
      limiter.queueJob({
        jobId: generateJobId(),
        job: ({ modelId }, _resolve, reject) => { reject(createMockUsage(modelId), { delegate: false }); return createMockJobResult('test'); },
        onError: (_error, ctx) => { capturedCtx = ctx; },
      })
    ).rejects.toThrow();
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(typeof ctx.totalCost).toBe('number');
  });
});
