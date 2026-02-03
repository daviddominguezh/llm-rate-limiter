/**
 * Tests for backend - fallback and rejection behavior.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type {
  AllocationInfo,
  BackendAcquireContext,
  BackendConfig,
  BackendReleaseContext,
  Unsubscribe,
} from '../multiModelTypes.js';
import {
  HALF,
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireConditional,
  createAcquireFalse,
  createConfigWithMemory,
  createDefaultConfig,
  createReleaseSimple,
} from './backend.helpers.js';
import {
  DEFAULT_JOB_TYPE,
  createDefaultResourceEstimations,
  createResourceEstimationsWithMemory,
} from './multiModelRateLimiter.helpers.js';

/** Creates a V2 backend config from acquire/release functions */
const createV2Backend = (
  acquire: (ctx: BackendAcquireContext) => Promise<boolean>,
  release: (ctx: BackendReleaseContext) => Promise<void>
): BackendConfig => ({
  register: async (): Promise<AllocationInfo> =>
    await Promise.resolve({ slots: TEN, tokensPerMinute: HUNDRED, requestsPerMinute: TEN }),
  unregister: async (): Promise<void> => {
    await Promise.resolve();
  },
  acquire,
  release,
  subscribe: (): Unsubscribe => (): void => {},
});

describe('backend - acquire returns false (fallback)', () => {
  it('should try next model when acquire returns false', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireConditional(acquireCalls, 'modelA'), createReleaseSimple()),
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      escalationOrder: ['modelA', 'modelB'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const result = await limiter.queueJob({
      jobId: 'fallback-job',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });

  it('should try next model and release memory when acquire returns false with memory config', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireConditional(acquireCalls, 'modelA'), createReleaseSimple()),
      models: { modelA: createConfigWithMemory(), modelB: createConfigWithMemory() },
      escalationOrder: ['modelA', 'modelB'],
      memory: { freeMemoryRatio: HALF },
      resourceEstimationsPerJob: createResourceEstimationsWithMemory(TEN),
    });
    await limiter.start();
    const result = await limiter.queueJob({
      jobId: 'fallback-with-memory',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });
});

describe('backend - acquire returns false (rejection)', () => {
  it('should throw when all models rejected by backend', async () => {
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireFalse(), createReleaseSimple()),
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const jobPromise = limiter.queueJob({
      jobId: 'all-rejected',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });

  it('should throw when all models rejected by backend (multiple models)', async () => {
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireFalse(), createReleaseSimple()),
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      escalationOrder: ['modelA', 'modelB'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const jobPromise = limiter.queueJob({
      jobId: 'all-rejected-multi',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
      },
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });
});
