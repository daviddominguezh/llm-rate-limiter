/**
 * Tests for backend - setDistributedAvailability and delegation.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type {
  AllocationInfo,
  Availability,
  AvailabilityChangeReason,
  BackendAcquireContext,
  BackendConfig,
  BackendReleaseContext,
  Unsubscribe,
} from '../multiModelTypes.js';
import { HUNDRED, ONE, TEN, ZERO, createDefaultConfig, createReleasePush } from './backend.helpers.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

describe('backend - setDistributedAvailability basic', () => {
  it('should emit onAvailableSlotsChange with distributed reason', () => {
    const calls: Array<{ availability: Availability; reason: AvailabilityChangeReason }> = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      onAvailableSlotsChange: (availability, reason) => {
        calls.push({ availability, reason });
      },
    });
    limiter.setDistributedAvailability({ slots: TEN, tokensPerMinute: HUNDRED });
    const distCall = calls.find((c) => c.reason === 'distributed');
    expect(distCall).toBeDefined();
    expect(distCall?.availability.slots).toBe(TEN);
    expect(distCall?.availability.tokensPerMinute).toBe(HUNDRED);
    expect(distCall?.availability.concurrentRequests).toBeNull();
    expect(distCall?.availability.memoryKB).toBeNull();
    limiter.stop();
  });

  it('should return early when no onAvailableSlotsChange callback', () => {
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(() => {
      limiter.setDistributedAvailability({ slots: TEN });
    }).not.toThrow();
    limiter.stop();
  });
});

describe('backend - setDistributedAvailability optional fields', () => {
  it('should handle optional fields in DistributedAvailability', () => {
    const calls: Availability[] = [];
    const limiter = createLLMRateLimiter({
      models: { default: createDefaultConfig() },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
      onAvailableSlotsChange: (availability, reason) => {
        if (reason === 'distributed') calls.push(availability);
      },
    });
    limiter.setDistributedAvailability({ slots: TEN });
    expect(calls[ZERO]?.tokensPerMinute).toBeNull();
    expect(calls[ZERO]?.tokensPerDay).toBeNull();
    expect(calls[ZERO]?.requestsPerMinute).toBeNull();
    expect(calls[ZERO]?.requestsPerDay).toBeNull();
    limiter.stop();
  });
});

/** Creates a V2 backend mock that always allows acquire and tracks release calls */
const createV2BackendMock = (releaseCalls: BackendReleaseContext[]): BackendConfig => {
  const defaultAllocation: AllocationInfo = { slots: TEN, tokensPerMinute: HUNDRED, requestsPerMinute: TEN };
  return {
    register: async (): Promise<AllocationInfo> => await Promise.resolve(defaultAllocation),
    unregister: async (): Promise<void> => {
      await Promise.resolve();
    },
    acquire: async (_ctx: BackendAcquireContext): Promise<boolean> => await Promise.resolve(true),
    release: createReleasePush(releaseCalls),
    subscribe: (_instanceId: string, callback: (allocation: AllocationInfo) => void): Unsubscribe => {
      callback(defaultAllocation);
      return (): void => {};
    },
  };
};

describe('backend - delegation with backend', () => {
  it('should call release on delegation', async () => {
    const releaseCalls: BackendReleaseContext[] = [];
    const limiter = createLLMRateLimiter({
      backend: createV2BackendMock(releaseCalls),
      models: { modelA: createDefaultConfig(), modelB: createDefaultConfig() },
      escalationOrder: ['modelA', 'modelB'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.start();
    let attempt = ZERO;
    const result = await limiter.queueJob({
      jobId: 'delegation-job',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve, reject) => {
        attempt += ONE;
        if (attempt === ONE) {
          reject({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO }, { delegate: true });
          return { requestCount: ZERO, usage: { input: ZERO, output: ZERO, cached: ZERO } };
        }
        resolve({ modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: TEN });
        return { requestCount: ONE, usage: { input: TEN, output: TEN, cached: ZERO } };
      },
    });
    expect(result.modelUsed).toBe('modelB');
    expect(releaseCalls.length).toBeGreaterThanOrEqual(ONE);
    limiter.stop();
  });
});
