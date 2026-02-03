/**
 * Tests for backend - acquire/release context functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendAcquireContext, BackendConfig, BackendReleaseContext } from '../multiModelTypes.js';
import {
  HUNDRED,
  ONE,
  TEN,
  ZERO,
  createAcquireTrue,
  createAcquireTrueSimple,
  createDefaultConfig,
  createReleasePush,
  createSimpleJob,
} from './backend.helpers.js';
import {
  DEFAULT_JOB_TYPE,
  createDefaultResourceEstimations,
  createFullResourceEstimations,
} from './multiModelRateLimiter.helpers.js';

/** Creates a V2 backend config from acquire/release functions */
const createV2Backend = (
  acquire: BackendConfig['acquire'],
  release: BackendConfig['release']
): BackendConfig => ({
  register: async () =>
    await Promise.resolve({ slots: ONE, tokensPerMinute: HUNDRED, requestsPerMinute: TEN }),
  unregister: async () => {
    await Promise.resolve();
  },
  acquire,
  release,
  subscribe: () => () => {},
});

describe('backend - acquire/release context', () => {
  it('should call acquire and release with correct context on successful job', async () => {
    const acquireCalls: BackendAcquireContext[] = [];
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireTrue(acquireCalls), createReleasePush(releaseCalls)),
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createFullResourceEstimations(ONE, HUNDRED),
    });
    await limiter.start();
    await limiter.queueJob({ jobId: 'test-job', jobType: DEFAULT_JOB_TYPE, job: createSimpleJob(TEN) });
    expect(acquireCalls).toHaveLength(ONE);
    expect(acquireCalls[ZERO]?.modelId).toBe('default');
    expect(acquireCalls[ZERO]?.jobId).toBe('test-job');
    expect(acquireCalls[ZERO]?.estimated).toEqual({ requests: ONE, tokens: HUNDRED });
    expect(releaseCalls).toHaveLength(ONE);
    expect(releaseCalls[ZERO]?.modelId).toBe('default');
    expect(releaseCalls[ZERO]?.actual).toEqual({ requests: ONE, tokens: TEN + TEN });
    limiter.stop();
  });
});

describe('backend - release on job error', () => {
  it('should call release with zero actual on job error', async () => {
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(createAcquireTrueSimple(), createReleasePush(releaseCalls)),
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const jobPromise = limiter.queueJob({
      jobId: 'error-job',
      jobType: DEFAULT_JOB_TYPE,
      job: (_, resolve) => {
        resolve({ modelId: 'default', inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
        throw new Error('Job failed');
      },
    });
    await expect(jobPromise).rejects.toThrow('Job failed');
    expect(releaseCalls).toHaveLength(ONE);
    expect(releaseCalls[ZERO]?.actual).toEqual({ requests: ZERO, tokens: ZERO });
    limiter.stop();
  });
});

describe('backend - release error handling', () => {
  it('should silently catch release errors', async () => {
    let acquireCalled = false;
    const acquireWithFlag = async (): Promise<boolean> => {
      acquireCalled = true;
      return await Promise.resolve(true);
    };
    const releaseWithError = async (): Promise<void> => {
      await Promise.reject(new Error('Release failed'));
    };
    const limiter = createLLMRateLimiter({
      backend: createV2Backend(acquireWithFlag, releaseWithError),
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    const result = await limiter.queueJob({
      jobId: 'release-error',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TEN),
    });
    expect(acquireCalled).toBe(true);
    expect(result.requestCount).toBe(ONE);
    limiter.stop();
  });
});
