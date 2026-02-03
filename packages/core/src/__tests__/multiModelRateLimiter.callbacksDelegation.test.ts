import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { JobCallbackContext, LLMRateLimiterInstance, UsageEntryWithCost } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  ONE,
  RPM_LIMIT_HIGH,
  TWO,
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

interface MockJobResult {
  requestCount: number;
  usage: { input: number; output: number; cached: number };
  [key: string]: unknown;
}
type ResolveUsage = (u: {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}) => void;
type RejectUsage = (
  u: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number },
  opts?: { delegate?: boolean }
) => void;
const createDelegatingJob = (resolve: ResolveUsage, reject: RejectUsage, modelId: string): MockJobResult => {
  const usage = createMockUsage(modelId);
  if (modelId === 'model-a') {
    reject(usage, { delegate: true });
  } else {
    resolve(usage);
  }
  return createMockJobResult('test');
};

describe('MultiModelRateLimiter - onError callback delegation', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onError with usage for models exhausted via delegation', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    const testJobId = generateJobId();
    await expect(
      limiter.queueJob({
        jobId: testJobId,
        jobType: DEFAULT_JOB_TYPE,
        job: ({ modelId }, _resolve, reject) => {
          reject(createMockUsage(modelId), { delegate: modelId === 'model-a' });
          return createMockJobResult('test');
        },
        onError: (_error, ctx) => {
          capturedCtx = ctx;
        },
      })
    ).rejects.toThrow();
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.jobId).toBe(testJobId);
  });
});

describe('MultiModelRateLimiter - callback with delegation models', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should call onComplete with usage from all attempted models after delegation', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': MODEL_CONFIG,
        'model-b': MODEL_CONFIG,
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCtx: JobCallbackContext | undefined = undefined;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => {
        const usage = createMockUsage(modelId);
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
    const ctx = ensureDefined<JobCallbackContext>(capturedCtx);
    expect(ctx.usage).toHaveLength(TWO);
    const delegatedFirstUsage = getUsageAt(ctx, ZERO);
    const delegatedSecondUsage = getUsageAt(ctx, ONE);
    expect(delegatedFirstUsage?.modelId).toBe('model-a');
    expect(delegatedSecondUsage?.modelId).toBe('model-b');
  });
});

describe('MultiModelRateLimiter - callback with delegation cost', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should accumulate totalCost from all attempted models', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': MODEL_CONFIG, 'model-b': MODEL_CONFIG },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let singleCost = ZERO;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('test');
      },
      onComplete: (_r, { totalCost }) => {
        singleCost = totalCost;
      },
    });
    let delegatedCost = ZERO;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => createDelegatingJob(resolve, reject, modelId),
      onComplete: (_r, { totalCost }) => {
        delegatedCost = totalCost;
      },
    });
    expect(delegatedCost).toBeCloseTo(singleCost * TWO);
  });
});
