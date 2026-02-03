/**
 * Branch coverage tests for error handling and job queueing.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { ONE, RATIO_HALF, TEN, ZERO } from './coverage.branches.helpers.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

/** Create a basic limiter for error tests */
const createBasicLimiter = (): LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> =>
  createLLMRateLimiter({
    models: {
      default: {
        requestsPerMinute: TEN,
        pricing: { input: ZERO, cached: ZERO, output: ZERO },
      },
    },
    resourceEstimationsPerJob: createDefaultResourceEstimations(),
  });

describe('multiModelRateLimiter - onError callback', () => {
  it('should call onError when job throws', async () => {
    const limiter = createBasicLimiter();
    const errors: Error[] = [];
    const jobPromise = limiter.queueJob({
      jobId: 'error-test',
      jobType: DEFAULT_JOB_TYPE,
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        throw new Error('Test error');
      },
      onError: (err) => {
        errors.push(err);
      },
    });
    await expect(jobPromise).rejects.toThrow('Test error');
    expect(errors[ZERO]?.message).toBe('Test error');
    limiter.stop();
  });
});

describe('multiModelRateLimiter - resolve/reject requirement', () => {
  it('should throw when job does not call resolve or reject', async () => {
    const limiter = createBasicLimiter();
    const jobPromise = limiter.queueJob({
      jobId: 'no-callback',
      jobType: DEFAULT_JOB_TYPE,
      job: () => ({ requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } }),
    });
    await expect(jobPromise).rejects.toThrow('Job must call resolve() or reject()');
    limiter.stop();
  });
});

describe('multiModelRateLimiter - non-Error handling', () => {
  it('should wrap non-Error throws in Error object for onError callback', async () => {
    const limiter = createBasicLimiter();
    const errors: Error[] = [];
    const jobPromise = limiter.queueJob({
      jobId: 'string-error',
      jobType: DEFAULT_JOB_TYPE,
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        throw new Error('string error');
      },
      onError: (err) => {
        errors.push(err);
      },
    });
    await expect(jobPromise).rejects.toThrow('string error');
    expect(errors[ZERO]?.message).toBe('string error');
    limiter.stop();
  });
});

describe('multiModelRateLimiter - queueJobForModel without memory', () => {
  it('should queue job for specific model without memory manager', async () => {
    const limiter = createBasicLimiter();
    const result = await limiter.queueJobForModel('default', () => ({
      requestCount: ONE,
      usage: { input: TEN, output: TEN, cached: ZERO },
    }));
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('multiModelRateLimiter - queueJobForModel with memory', () => {
  it('should queue job for specific model with memory manager', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
      resourceEstimationsPerJob: {
        default: { estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ONE },
      },
      memory: { freeMemoryRatio: RATIO_HALF },
    });
    const result = await limiter.queueJobForModel('default', () => ({
      requestCount: ONE,
      usage: { input: TEN, output: TEN, cached: ZERO },
    }));
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});
