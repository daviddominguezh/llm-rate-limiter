import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  DELAY_MS_LONG,
  DELAY_MS_SHORT,
  ONE,
  ZERO,
  createDefaultResourceEstimations,
  createMockJobResult,
  createMockUsage,
  generateJobId,
} from './multiModelRateLimiter.helpers.js';

type DefaultJobType = typeof DEFAULT_JOB_TYPE;

describe('MultiModelRateLimiter - resource release after resolve', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should free resources only after job resolves', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING } },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ZERO);

    const jobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(DELAY_MS_LONG);
        resolve(createMockUsage(modelId));
        return createMockJobResult('test');
      },
    });

    await setTimeoutAsync(DELAY_MS_SHORT);
    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ONE);
    expect(limiter.hasCapacityForModel('model-a')).toBe(false);

    await jobPromise;

    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ZERO);
    expect(limiter.hasCapacityForModel('model-a')).toBe(true);
  });
});

describe('MultiModelRateLimiter - resource release after reject', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should free resources only after job rejects without delegation', async () => {
    limiter = createLLMRateLimiter({
      models: { 'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING } },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ZERO);

    const jobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, _resolve, reject) => {
        await setTimeoutAsync(DELAY_MS_LONG);
        reject(createMockUsage(modelId), { delegate: false });
        return createMockJobResult('test');
      },
    });

    await setTimeoutAsync(DELAY_MS_SHORT);
    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ONE);

    await expect(jobPromise).rejects.toThrow('Job rejected without delegation');

    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ZERO);
  });
});

describe('MultiModelRateLimiter - resource release per model', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should free resources only for the model that resolved', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
        'model-b': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });

    const jobAPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(DELAY_MS_SHORT);
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-a');
      },
    });

    await setTimeoutAsync(DELAY_MS_SHORT);

    const jobBPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(DELAY_MS_LONG);
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-b');
      },
    });

    await setTimeoutAsync(DELAY_MS_SHORT);

    await jobAPromise;

    expect(limiter.getModelStats('model-a').concurrency?.active).toBe(ZERO);
    expect(limiter.getModelStats('model-b').concurrency?.active).toBe(ONE);

    await jobBPromise;

    expect(limiter.getModelStats('model-b').concurrency?.active).toBe(ZERO);
  });
});

describe('MultiModelRateLimiter - resource release on delegation', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should free resources for delegated model before trying next', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'model-a': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
        'model-b': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
      },
      escalationOrder: ['model-a', 'model-b'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    const concurrencySnapshots: Array<{ a: number; b: number }> = [];
    const localLimiter = limiter;
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => {
        const statsA = localLimiter.getModelStats('model-a');
        const statsB = localLimiter.getModelStats('model-b');
        concurrencySnapshots.push({
          a: statsA.concurrency?.active ?? ZERO,
          b: statsB.concurrency?.active ?? ZERO,
        });
        const usage = createMockUsage(modelId);
        if (modelId === 'model-a') {
          reject(usage, { delegate: true });
        } else {
          resolve(usage);
        }
        return createMockJobResult('result');
      },
    });
    expect(concurrencySnapshots[ZERO]).toEqual({ a: ONE, b: ZERO });
    expect(concurrencySnapshots[ONE]).toEqual({ a: ZERO, b: ONE });
  });
});
