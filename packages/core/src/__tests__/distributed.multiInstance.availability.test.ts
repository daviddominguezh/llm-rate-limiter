/**
 * Tests for distributed rate limiting - availability notifications and pub/sub.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { Availability, AvailabilityChangeReason, LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  FIFTY,
  HUNDRED,
  MS_PER_MINUTE_PLUS_ONE,
  ONE,
  TEN,
  THREE,
  TWENTY,
  TWO,
  ZERO,
  cleanupInstances,
  createModelConfig,
} from './distributed.multiInstance.helpers.js';
import { createConnectedLimiters, createDistributedBackend } from './distributedBackend.helpers.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

interface JobResult {
  requestCount: number;
  usage: { input: number; output: number; cached: number };
  [key: string]: unknown;
}
interface TokenJobOptions {
  jobId: string;
  jobType: string;
  job: (
    args: { modelId: string },
    resolve: (u: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
  ) => JobResult;
}
const createTokenJob = (jobId: string, tokens: number): TokenJobOptions => ({
  jobId,
  jobType: DEFAULT_JOB_TYPE,
  job: (
    { modelId }: { modelId: string },
    resolve: (u: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
  ) => {
    resolve({ modelId, inputTokens: tokens, cachedTokens: ZERO, outputTokens: ZERO });
    return { requestCount: ONE, usage: { input: tokens, output: ZERO, cached: ZERO } };
  },
});

describe('distributed - availability notifications', () => {
  it('should notify all instances when availability changes', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const availabilityChanges: Array<{ instanceId: number; reason: AvailabilityChangeReason }> = [];
    const instances = await createConnectedLimiters(
      THREE,
      distributedBackend,
      (backend, instanceId) =>
        createLLMRateLimiter({
          backend,
          models: { default: createModelConfig(TEN, ONE) },
          resourceEstimationsPerJob: createDefaultResourceEstimations(),
          onAvailableSlotsChange: (_availability, reason, _modelId, _adjustment) => {
            availabilityChanges.push({ instanceId, reason });
          },
        }) as LLMRateLimiterInstance
    );
    const [instance1] = instances;
    if (instance1 === undefined) throw new Error('Instance not created');
    await instance1.limiter.queueJob({
      jobId: 'trigger-change',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: ZERO });
        return { requestCount: ONE, usage: { input: TEN, output: ZERO, cached: ZERO } };
      },
    });
    const distributedChanges = availabilityChanges.filter((c) => c.reason === 'distributed');
    const uniqueInstances = new Set(distributedChanges.map((c) => c.instanceId));
    expect(uniqueInstances.size).toBe(THREE);
    cleanupInstances(instances);
  });
});

describe('distributed - time window reset jobs', () => {
  it('should allow jobs after time window resets', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: FIFTY,
      requestsPerMinute: TWO,
      estimatedTokensPerRequest: TWENTY,
    });
    const instances = await createConnectedLimiters(
      ONE,
      distributedBackend,
      (backend) =>
        createLLMRateLimiter({
          backend,
          models: { default: createModelConfig(TWENTY, ONE) },
          resourceEstimationsPerJob: createDefaultResourceEstimations(),
        }) as LLMRateLimiterInstance
    );
    const [instance] = instances;
    if (instance === undefined) throw new Error('Instance not created');
    await instance.limiter.queueJob(createTokenJob('job1', TWENTY));
    await instance.limiter.queueJob(createTokenJob('job2', TWENTY));
    expect(distributedBackend.getAvailability().requestsPerMinute).toBe(ZERO);
    distributedBackend.advanceTime(MS_PER_MINUTE_PLUS_ONE);
    const afterReset = distributedBackend.getAvailability();
    expect(afterReset.requestsPerMinute).toBe(TWO);
    expect(afterReset.tokensPerMinute).toBe(FIFTY);
    await instance.limiter.queueJob(createTokenJob('job3', TEN));
    expect(distributedBackend.getStats().totalAcquires).toBe(THREE);
    cleanupInstances(instances);
  });
});

describe('distributed - setDistributedAvailability basic', () => {
  it('should update limiter availability when backend pushes update', () => {
    const receivedAvailabilities: Availability[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: createModelConfig(TEN, ONE) },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      onAvailableSlotsChange: (availability, reason, _modelId, _adjustment) => {
        if (reason === 'distributed') {
          receivedAvailabilities.push(availability);
        }
      },
    });
    limiter.setDistributedAvailability({ slots: FIFTY, tokensPerMinute: HUNDRED, requestsPerMinute: TEN });
    expect(receivedAvailabilities).toHaveLength(ONE);
    expect(receivedAvailabilities[ZERO]?.slots).toBe(FIFTY);
    expect(receivedAvailabilities[ZERO]?.tokensPerMinute).toBe(HUNDRED);
    limiter.stop();
  });
});

describe('distributed - setDistributedAvailability propagation', () => {
  it('should propagate availability to all subscribed limiters', async () => {
    const distributedBackend = createDistributedBackend({
      tokensPerMinute: HUNDRED,
      requestsPerMinute: TEN,
      estimatedTokensPerRequest: TEN,
    });
    const receivedByInstance = new Map<number, Availability[]>();
    const instances = await createConnectedLimiters(THREE, distributedBackend, (backend, instanceId) => {
      receivedByInstance.set(instanceId, []);
      return createLLMRateLimiter({
        backend,
        models: { default: createModelConfig(TEN, ONE) },
        resourceEstimationsPerJob: createDefaultResourceEstimations(),
        onAvailableSlotsChange: (availability, reason, _modelId, _adjustment) => {
          if (reason === 'distributed') {
            receivedByInstance.get(instanceId)?.push(availability);
          }
        },
      }) as LLMRateLimiterInstance;
    });
    distributedBackend.reset();
    for (const [, received] of receivedByInstance) {
      expect(received.length).toBeGreaterThanOrEqual(ONE);
      const [last] = received.slice(received.length - ONE);
      expect(last?.tokensPerMinute).toBe(HUNDRED);
    }
    cleanupInstances(instances);
  });
});
