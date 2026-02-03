/**
 * Tests for distributed rate limiting - token coordination across instances.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  FIFTY,
  HUNDRED,
  ONE,
  TEN,
  TWENTY,
  TWO,
  cleanupInstances,
  createLimiterWithBackend,
  createModelConfig,
  createSimpleJob,
} from './distributed.multiInstance.helpers.js';
import { createConnectedLimiters, createDistributedBackend } from './distributedBackend.helpers.js';

const DEFAULT_JOB_TYPE = 'default';

describe('distributed - coordinate token usage', () => {
  it('should coordinate token usage across instances', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const instances = await createConnectedLimiters(TWO, distributedBackend, createLimiterWithBackend);
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) throw new Error('Instances not created');
    await instance1.limiter.queueJob({
      jobId: 'job1',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TWENTY),
    });
    expect(distributedBackend.getStats().totalAcquires).toBe(ONE);
    await instance2.limiter.queueJob({
      jobId: 'job2',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(TWENTY),
    });
    expect(distributedBackend.getStats().totalAcquires).toBe(TWO);
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TWENTY - TWENTY);
    cleanupInstances(instances);
  });
});

const createResourceEstimations = (tokens: number) => ({
  [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: tokens },
});

describe('distributed - reject when exceeding limit', () => {
  it('should reject when combined usage exceeds limit', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIFTY,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: FIFTY,
    });
    const instances = await createConnectedLimiters(
      TWO,
      distributedBackend,
      (backend) =>
        createLLMRateLimiter({
          backend,
          models: { default: createModelConfig(FIFTY, ONE) },
          resourceEstimationsPerJob: createResourceEstimations(FIFTY),
        }) as LLMRateLimiterInstance
    );
    const [instance1, instance2] = instances;
    if (instance1 === undefined || instance2 === undefined) throw new Error('Instances not created');
    await instance1.limiter.queueJob({
      jobId: 'job1',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(FIFTY),
    });
    const jobPromise = instance2.limiter.queueJob({
      jobId: 'job2',
      jobType: DEFAULT_JOB_TYPE,
      job: createSimpleJob(FIFTY),
    });
    await expect(jobPromise).rejects.toThrow('All models rejected by backend');
    cleanupInstances(instances);
  });
});

describe('distributed - token refund', () => {
  it('should refund unused tokens on release', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: FIFTY,
    });
    const instances = await createConnectedLimiters(
      ONE,
      distributedBackend,
      (backend) =>
        createLLMRateLimiter({
          backend,
          models: { default: createModelConfig(FIFTY, ONE) },
          resourceEstimationsPerJob: createResourceEstimations(FIFTY),
        }) as LLMRateLimiterInstance
    );
    const [instance] = instances;
    if (instance === undefined) throw new Error('Instance not created');
    await instance.limiter.queueJob({ jobId: 'job1', jobType: DEFAULT_JOB_TYPE, job: createSimpleJob(TEN) });
    expect(distributedBackend.getAvailability().tokensPerMinute).toBe(HUNDRED - TEN);
    cleanupInstances(instances);
  });
});
