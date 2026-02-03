import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { JobCallbackContext, LLMRateLimiterInstance, UsageEntryWithCost } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  DELAY_MS_LONG,
  DELAY_MS_SHORT,
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
  ONE,
  RPM_LIMIT_HIGH,
  ZERO,
  createDefaultResourceEstimations,
  createMockJobResult,
  createMockUsage,
  ensureDefined,
  generateJobId,
} from './multiModelRateLimiter.helpers.js';

const MODEL_CONFIG = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: DEFAULT_PRICING,
};
const getUsageAt = (ctx: JobCallbackContext | undefined, index: number): UsageEntryWithCost | undefined =>
  ctx?.usage[index];

const createResolvingJob = (
  modelId: string,
  resolve: (u: ReturnType<typeof createMockUsage>) => void
): ReturnType<typeof createMockJobResult> => {
  resolve(createMockUsage(modelId));
  return createMockJobResult('test');
};

const createRejectingJob = (
  modelId: string,
  reject: (u: ReturnType<typeof createMockUsage>, opts: { delegate: boolean }) => void
): ReturnType<typeof createMockJobResult> => {
  reject(createMockUsage(modelId), { delegate: false });
  return createMockJobResult('test');
};

describe('MultiModelRateLimiter - onComplete jobId and usage', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onComplete with proper jobId and usage when job resolves', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await limiter.queueJob({
      jobId: testJobId,
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => createResolvingJob(modelId, resolve),
      onComplete: (_r, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    expect(getUsageAt(capturedCtx, ZERO)?.modelId).toBe('model-a');
    expect(getUsageAt(capturedCtx, ZERO)?.inputTokens).toBe(MOCK_INPUT_TOKENS);
    expect(getUsageAt(capturedCtx, ZERO)?.outputTokens).toBe(MOCK_OUTPUT_TOKENS);
  });
});

describe('MultiModelRateLimiter - onComplete totalCost', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should include totalCost in onComplete callback', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => createResolvingJob(modelId, resolve),
      onComplete: (_r, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.totalCost).toBeDefined();
    expect(typeof ctx.totalCost).toBe('number');
  });
});

describe('MultiModelRateLimiter - onComplete callback skipping', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onComplete with usage only for the model that processed when skipping', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
        'model-b': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    const blockingJobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(DELAY_MS_LONG);
        resolve(createMockUsage(modelId));
        return createMockJobResult('blocking');
      },
    });
    await setTimeoutAsync(DELAY_MS_SHORT);
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await limiter.queueJob({
      jobId: testJobId,
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => createResolvingJob(modelId, resolve),
      onComplete: (_r, ctx) => {
        capturedCtx = ctx;
      },
    });
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    expect(getUsageAt(ctx, ZERO)?.modelId).toBe('model-b');
    await blockingJobPromise;
  });
});

describe('MultiModelRateLimiter - onError jobId and usage', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onError with proper jobId and usage when job rejects without delegation', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await expect(
      limiter.queueJob({
        jobId: testJobId,
        jobType: DEFAULT_JOB_TYPE,
        job: ({ modelId }, _resolve, reject) => createRejectingJob(modelId, reject),
        onError: (_e, ctx) => {
          capturedCtx = ctx;
        },
      })
    ).rejects.toThrow();
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
    expect(ctx.usage).toHaveLength(ONE);
    expect(getUsageAt(ctx, ZERO)?.modelId).toBe('model-a');
  });
});

describe('MultiModelRateLimiter - onError totalCost', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should include totalCost in onError callback', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await expect(
      limiter.queueJob({
        jobId: generateJobId(),
        jobType: DEFAULT_JOB_TYPE,
        job: ({ modelId }, _resolve, reject) => createRejectingJob(modelId, reject),
        onError: (_e, ctx) => {
          capturedCtx = ctx;
        },
      })
    ).rejects.toThrow();
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(typeof ctx.totalCost).toBe('number');
  });
});
