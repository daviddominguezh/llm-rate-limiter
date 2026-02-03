/**
 * Tests for backend - misc and edge case scenarios.
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
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireConditional,
  createAcquireFalse,
  createAcquireTrue,
  createDefaultConfig,
  createReleaseSimple,
  createRequestOnlyConfig,
  createSimpleJob,
  createTokenOnlyConfig,
  createTwoModelConfig,
} from './backend.helpers.js';
import {
  DEFAULT_JOB_TYPE,
  createDefaultResourceEstimations,
  createTokenOnlyResourceEstimations,
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

describe('backend - no backend configured', () => {
  it('should work without backend', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    const result = await limiter.queueJob({
      jobId: 'no-backend',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TEN),
    });
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});

describe('backend - model with partial resource estimates', () => {
  it('should use zero for missing token estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireTrue(acquireCalls), createReleaseSimple()),
      models: { default: createRequestOnlyConfig(TEN) },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    await limiter.queueJob({
      jobId: 'no-token-estimates',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TEN),
    });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ONE, tokens: ZERO });
    limiter.stop();
  });

  it('should use zero for missing request estimates', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireTrue(acquireCalls), createReleaseSimple()),
      models: { default: createTokenOnlyConfig(HUNDRED, TEN) },
      resourceEstimationsPerJob: createTokenOnlyResourceEstimations(TEN),
    });
    await limiter.start();
    await limiter.queueJob({
      jobId: 'no-request-estimates',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TEN),
    });
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ZERO, tokens: TEN });
    limiter.stop();
  });
});

describe('backend - without memory manager (all rejected)', () => {
  it('should handle backend rejection without memory manager', async () => {
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireFalse(), createReleaseSimple()),
      models: { default: createTokenOnlyConfig(HUNDRED, TEN) },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const jobPromise = limiter.queueJob({
      jobId: 'no-memory',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(ZERO),
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    limiter.stop();
  });
});

describe('backend - without memory manager (fallback)', () => {
  it('should handle backend rejection and fallback without memory manager', async () => {
    const acquireCalls: string[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireConditional(acquireCalls, 'modelA'), createReleaseSimple()),
      models: createTwoModelConfig(HUNDRED, TEN),
      escalationOrder: ['modelA', 'modelB'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const result = await limiter.queueJob({
      jobId: 'fallback-no-memory',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TEN),
    });
    expect(acquireCalls).toEqual(['modelA', 'modelB']);
    expect(result.modelUsed).toBe('modelB');
    limiter.stop();
  });
});
