/**
 * Tests for distributed rate limiting - edge cases and misc functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  HUNDRED,
  ONE,
  TEN,
  TWO,
  ZERO,
  cleanupInstances,
  createLimiterWithBackend,
  createModelConfig,
} from './distributed.multiInstance.helpers.js';
import {
  createConnectedLimiters,
  createDistributedBackend,
  createJobTracker,
} from './distributedBackend.helpers.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

describe('distributed - request refund on release', () => {
  it('should refund unused requests when actual < estimated', async () => {
    const ESTIMATED_REQUESTS = TWO;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const instances = await createConnectedLimiters(
      ONE,
      distributedBackend,
      (backend) =>
        createLLMRateLimiter({
          backend,
          models: { default: { ...createModelConfig(TEN, ESTIMATED_REQUESTS) } },
          resourceEstimationsPerJob: createDefaultResourceEstimations(),
        }) as LLMRateLimiterInstance
    );
    const [instance] = instances;
    if (instance === undefined) throw new Error('Instance not created');
    await instance.limiter.queueJob({
      jobId: 'job1',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
      },
    });
    expect(distributedBackend.getStats().totalReleases).toBe(ONE);
    cleanupInstances(instances);
  });
});

describe('distributed - backend edge cases', () => {
  it('should handle getCurrentTime correctly', () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const initialTime = distributedBackend.getCurrentTime();
    distributedBackend.advanceTime(HUNDRED);
    expect(distributedBackend.getCurrentTime()).toBe(initialTime + HUNDRED);
  });

  it('should handle release for a model that was reset', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const instances = await createConnectedLimiters(ONE, distributedBackend, createLimiterWithBackend);
    const [instance] = instances;
    if (instance === undefined) throw new Error('Instance not created');
    await instance.limiter.queueJob({
      jobId: 'job1',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
      },
    });
    distributedBackend.reset();
    expect(distributedBackend.getStats().totalAcquires).toBe(ZERO);
    cleanupInstances(instances);
  });
});

describe('distributed - job tracker', () => {
  it('should track completed jobs', () => {
    const tracker = createJobTracker();
    tracker.trackComplete(ZERO, TEN);
    expect(tracker.completed).toBe(ONE);
    expect(tracker.totalTokens).toBe(TEN);
  });

  it('should track failed jobs with Error objects', () => {
    const tracker = createJobTracker();
    tracker.trackFailed(new Error('test error'));
    expect(tracker.failed).toBe(ONE);
    expect(tracker.errors).toHaveLength(ONE);
  });

  it('should handle non-Error objects in trackFailed', () => {
    const tracker = createJobTracker();
    tracker.trackFailed('string error');
    expect(tracker.failed).toBe(ONE);
    expect(tracker.errors).toHaveLength(ZERO);
  });
});
