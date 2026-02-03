/**
 * Load tests for distributed rate limiting.
 * Tests that multiple instances coordinate properly under high load.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendConfig, LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import {
  type JobTracker,
  createConnectedLimiters,
  createDistributedBackend,
  createJobTracker,
} from './distributedBackend.helpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const FIFTY = 50;
const HUNDRED = 100;
const TWO_HUNDRED = 200;
const FIVE_HUNDRED = 500;
const THOUSAND = 1000;
const FIVE_THOUSAND = 5000;
const MS_PER_MINUTE_PLUS_ONE = 60_001;
const STRESS_TEST_TIMEOUT = 30_000;

type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;

const createModelConfig = (_estimatedTokens: number, _estimatedRequests: number): ModelRateLimitConfig => ({
  requestsPerMinute: THOUSAND,
  tokensPerMinute: THOUSAND * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) {
    unsubscribe();
    limiter.stop();
  }
};

const createLimiterForBackend = (backend: BackendConfig, tokensPerJob: number): LLMRateLimiterInstance =>
  createLLMRateLimiter({ backend, models: { default: createModelConfig(tokensPerJob, ONE) } });

/** Run a batch of jobs across multiple instances */
const runJobBatch = async (
  instances: InstanceArray,
  jobCount: number,
  tokensPerJob: number,
  tracker: JobTracker
): Promise<void> => {
  const promises: Array<Promise<void>> = [];
  for (let i = ZERO; i < jobCount; i += ONE) {
    const instanceIndex = i % instances.length;
    const { limiter } = instances[instanceIndex] ?? {};
    if (limiter === undefined) {
      continue;
    }
    const jobId = `job-${i}`;
    const promise = limiter
      .queueJob({
        jobId,
        job: ({ modelId }, resolve) => {
          resolve({ modelId, inputTokens: tokensPerJob, cachedTokens: ZERO, outputTokens: ZERO });
          return { requestCount: ONE, usage: { input: tokensPerJob, output: ZERO, cached: ZERO } };
        },
      })
      .then(() => {
        tracker.trackComplete(instanceIndex, tokensPerJob);
      })
      .catch((error: unknown) => {
        tracker.trackFailed(error);
      });
    promises.push(promise);
  }
  await Promise.all(promises);
};

describe('distributed - load test coordination basic', () => {
  it('should coordinate 100 jobs across 3 instances without exceeding limits', async () => {
    const TOKENS_PER_JOB = FIVE;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIVE_HUNDRED,
      requestsPerMinute: HUNDRED,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(THREE, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker = createJobTracker();
    await runJobBatch(instances, HUNDRED, TOKENS_PER_JOB, tracker);
    const stats = distributedBackend.getStats();
    expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(FIVE_HUNDRED);
    expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(HUNDRED);
    expect(tracker.completed).toBe(HUNDRED);
    expect(tracker.failed).toBe(ZERO);
    cleanupInstances(instances);
  });
});

describe('distributed - load test rejection', () => {
  it('should reject jobs that would exceed combined limit', async () => {
    const TOKENS_PER_JOB = TEN;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIFTY,
      requestsPerMinute: FIVE,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(TWO, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker = createJobTracker();
    await runJobBatch(instances, TEN, TOKENS_PER_JOB, tracker);
    const stats = distributedBackend.getStats();
    expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(FIFTY);
    expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(FIVE);
    expect(tracker.completed).toBe(FIVE);
    expect(tracker.failed).toBe(FIVE);
    expect(stats.rejections).toBe(FIVE);
    cleanupInstances(instances);
  });
});

describe('distributed - load distribution even', () => {
  it('should distribute load evenly across instances', async () => {
    const TOKENS_PER_JOB = TEN;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: THOUSAND,
      requestsPerMinute: HUNDRED,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(FIVE, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker = createJobTracker();
    await runJobBatch(instances, HUNDRED, TOKENS_PER_JOB, tracker);
    const expectedJobsPerInstance = HUNDRED / FIVE;
    for (let i = ZERO; i < FIVE; i += ONE) {
      const jobs = tracker.jobsPerInstance.get(i) ?? ZERO;
      expect(jobs).toBe(expectedJobsPerInstance);
    }
    cleanupInstances(instances);
  });
});

describe('distributed - load distribution concurrent', () => {
  it('should never exceed token limit even under concurrent load', async () => {
    const TOKENS_PER_JOB = TWENTY;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: TWO_HUNDRED,
      requestsPerMinute: FIFTY,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(FIVE, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker = createJobTracker();
    const batchPromises: Array<Promise<void>> = [];
    for (const instance of instances) {
      batchPromises.push(runJobBatch([instance], TEN, TOKENS_PER_JOB, tracker));
    }
    await Promise.all(batchPromises);
    const stats = distributedBackend.getStats();
    expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(TWO_HUNDRED);
    expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(FIFTY);
    cleanupInstances(instances);
  });
});

describe('distributed - time window reset', () => {
  it('should allow more jobs after time window reset', async () => {
    const TOKENS_PER_JOB = TEN;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIFTY,
      requestsPerMinute: FIVE,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(TWO, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker1 = createJobTracker();
    await runJobBatch(instances, TEN, TOKENS_PER_JOB, tracker1);
    expect(tracker1.completed).toBe(FIVE);
    expect(tracker1.failed).toBe(FIVE);
    distributedBackend.advanceTime(MS_PER_MINUTE_PLUS_ONE);
    const tracker2 = createJobTracker();
    await runJobBatch(instances, TEN, TOKENS_PER_JOB, tracker2);
    expect(tracker2.completed).toBe(FIVE);
    expect(tracker2.failed).toBe(FIVE);
    expect(tracker1.completed + tracker2.completed).toBe(TEN);
    cleanupInstances(instances);
  });
});

describe('distributed - peak usage tracking', () => {
  it('should track peak usage correctly under burst load', async () => {
    const TOKENS_PER_JOB = FIFTY;
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: THOUSAND,
      requestsPerMinute: HUNDRED,
      estimatedTokensPerRequest: TOKENS_PER_JOB,
    });
    const instances = createConnectedLimiters(TWO, distributedBackend, (b) =>
      createLimiterForBackend(b, TOKENS_PER_JOB)
    );
    const tracker = createJobTracker();
    await runJobBatch(instances, TWENTY, TOKENS_PER_JOB, tracker);
    const stats = distributedBackend.getStats();
    expect(stats.peakTokensPerMinute).toBe(TWENTY * TOKENS_PER_JOB);
    expect(stats.peakRequestsPerMinute).toBe(TWENTY);
    expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(THOUSAND);
    expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(HUNDRED);
    cleanupInstances(instances);
  });
});

describe('distributed - stress test', () => {
  it(
    'should handle 500 jobs across 5 instances',
    async () => {
      const TOKENS_PER_JOB = TEN;
      const distributedBackend = createDistributedBackend({
        tokensPerMinute: FIVE_THOUSAND,
        requestsPerMinute: FIVE_HUNDRED,
        estimatedTokensPerRequest: TOKENS_PER_JOB,
      });
      const instances = createConnectedLimiters(FIVE, distributedBackend, (b) =>
        createLimiterForBackend(b, TOKENS_PER_JOB)
      );
      const tracker = createJobTracker();
      await runJobBatch(instances, FIVE_HUNDRED, TOKENS_PER_JOB, tracker);
      const stats = distributedBackend.getStats();
      expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(FIVE_THOUSAND);
      expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(FIVE_HUNDRED);
      expect(tracker.completed).toBe(FIVE_HUNDRED);
      expect(tracker.failed).toBe(ZERO);
      expect(stats.totalAcquires).toBe(FIVE_HUNDRED);
      expect(stats.totalReleases).toBe(FIVE_HUNDRED);
      cleanupInstances(instances);
    },
    STRESS_TEST_TIMEOUT
  );
});
