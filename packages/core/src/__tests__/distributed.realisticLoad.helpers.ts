/**
 * Shared helpers for distributed realistic load tests.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendConfig, LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import type { DistributedBackendInstance } from './distributedBackend.helpers.js';
import { DEFAULT_JOB_TYPE, createDefaultResourceEstimations } from './multiModelRateLimiter.helpers.js';

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const FIVE = 5;
export const TEN = 10;
export const TWENTY = 20;
export const THIRTY = 30;
export const FIFTY = 50;
export const HUNDRED = 100;
export const FIVE_HUNDRED = 500;
export const THOUSAND = 1000;
export const REALISTIC_TEST_TIMEOUT = 120_000;

export type InstanceArray = Array<{
  limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE>;
  unsubscribe: () => void;
}>;

export interface LatencyConfig {
  acquireMinMs: number;
  acquireMaxMs: number;
  releaseMinMs: number;
  releaseMaxMs: number;
}

export interface JobConfig {
  minDurationMs: number;
  maxDurationMs: number;
  tokens: number;
}

export interface LimiterSetupConfig {
  count: number;
  backend: DistributedBackendInstance;
  latency: LatencyConfig;
  tokensPerJob: number;
}

export interface TestTracker {
  completed: number;
  failed: number;
  totalDurationMs: number;
  acquireLatencies: number[];
  releaseLatencies: number[];
  jobDurations: number[];
  trackComplete: () => void;
  trackFailed: () => void;
  trackAcquireLatency: (ms: number) => void;
  trackReleaseLatency: (ms: number) => void;
  trackJobDuration: (ms: number) => void;
  setTotalDuration: (ms: number) => void;
}

export const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + ONE)) + min;

export const createTestTracker = (): TestTracker => {
  const tracker: TestTracker = {
    completed: ZERO,
    failed: ZERO,
    totalDurationMs: ZERO,
    acquireLatencies: [],
    releaseLatencies: [],
    jobDurations: [],
    trackComplete: () => {
      tracker.completed += ONE;
    },
    trackFailed: () => {
      tracker.failed += ONE;
    },
    trackAcquireLatency: (ms) => {
      tracker.acquireLatencies.push(ms);
    },
    trackReleaseLatency: (ms) => {
      tracker.releaseLatencies.push(ms);
    },
    trackJobDuration: (ms) => {
      tracker.jobDurations.push(ms);
    },
    setTotalDuration: (ms) => {
      tracker.totalDurationMs = ms;
    },
  };
  return tracker;
};

export const createModelConfig = (_estimatedTokens: number): ModelRateLimitConfig => ({
  requestsPerMinute: HUNDRED,
  tokensPerMinute: HUNDRED * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

export const wrapBackendWithLatency = (
  backend: BackendConfig,
  latency: LatencyConfig,
  tracker: TestTracker
): BackendConfig => ({
  register: (instanceId) => backend.register(instanceId),
  unregister: (instanceId) => backend.unregister(instanceId),
  acquire: async (ctx): Promise<boolean> => {
    const ms = randomInt(latency.acquireMinMs, latency.acquireMaxMs);
    tracker.trackAcquireLatency(ms);
    await sleep(ms);
    return await backend.acquire(ctx);
  },
  release: async (ctx): Promise<void> => {
    const ms = randomInt(latency.releaseMinMs, latency.releaseMaxMs);
    tracker.trackReleaseLatency(ms);
    await sleep(ms);
    await backend.release(ctx);
  },
  subscribe: (instanceId, callback) => backend.subscribe(instanceId, callback),
});

export const createLatencyLimiters = async (
  config: LimiterSetupConfig,
  tracker: TestTracker
): Promise<InstanceArray> => {
  const instances: InstanceArray = [];
  for (let i = ZERO; i < config.count; i += ONE) {
    const wrappedBackend = wrapBackendWithLatency(config.backend.backend, config.latency, tracker);
    const limiter = createLLMRateLimiter({
      backend: wrappedBackend,
      models: { default: createModelConfig(config.tokensPerJob) },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: config.tokensPerJob },
      },
    });
    await limiter.start();
    const unsubscribe = config.backend.subscribe((avail) => {
      limiter.setDistributedAvailability(avail);
    });
    instances.push({ limiter, unsubscribe });
  }
  return instances;
};

export const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) {
    unsubscribe();
    limiter.stop();
  }
};

export const fireSlowJobs = async (
  instances: InstanceArray,
  jpi: number,
  jobConfig: JobConfig,
  tracker: TestTracker
): Promise<void> => {
  const allPromises: Array<Promise<void>> = [];
  for (let i = ZERO; i < instances.length; i += ONE) {
    const { limiter } = instances[i] ?? {};
    if (limiter === undefined) continue;
    for (let j = ZERO; j < jpi; j += ONE) {
      const promise = limiter
        .queueJob({
          jobId: `i${i}-j${j}`,
          jobType: DEFAULT_JOB_TYPE,
          job: async ({ modelId }, resolve) => {
            const duration = randomInt(jobConfig.minDurationMs, jobConfig.maxDurationMs);
            tracker.trackJobDuration(duration);
            await sleep(duration);
            resolve({ modelId, inputTokens: jobConfig.tokens, cachedTokens: ZERO, outputTokens: ZERO });
            return { requestCount: ONE, usage: { input: jobConfig.tokens, output: ZERO, cached: ZERO } };
          },
        })
        .then(() => {
          tracker.trackComplete();
        })
        .catch(() => {
          tracker.trackFailed();
        });
      allPromises.push(promise);
    }
  }
  const startTime = Date.now();
  await Promise.all(allPromises);
  tracker.setTotalDuration(Date.now() - startTime);
};

export const assertLimitsRespected = (
  stats: ReturnType<DistributedBackendInstance['getStats']>,
  tpm: number,
  rpm: number
): void => {
  expect(stats.peakTokensPerMinute).toBeLessThanOrEqual(tpm);
  expect(stats.peakRequestsPerMinute).toBeLessThanOrEqual(rpm);
};

export const calculateAverage = (arr: number[]): number => {
  if (arr.length === ZERO) return ZERO;
  let sum = ZERO;
  for (const val of arr) {
    sum += val;
  }
  return Math.round(sum / arr.length);
};

/** Test setup configuration for latency tests */
export interface TestSetup {
  backend: DistributedBackendInstance;
  tracker: TestTracker;
  instances: InstanceArray;
  tpm: number;
  rpm: number;
  jpi: number;
}

/** Creates a standard latency test setup */
export const createLatencyTestSetup = async (
  backendFactory: (config: {
    tokensPerMinute: number;
    requestsPerMinute: number;
    estimatedTokensPerRequest: number;
  }) => DistributedBackendInstance,
  config: {
    tpm: number;
    rpm: number;
    instanceCount: number;
    jobsPerInstance: number;
    tokensPerJob: number;
    latency: LatencyConfig;
  }
): Promise<TestSetup> => {
  const backend = backendFactory({
    tokensPerMinute: config.tpm,
    requestsPerMinute: config.rpm,
    estimatedTokensPerRequest: config.tokensPerJob,
  });
  const tracker = createTestTracker();
  const instances = await createLatencyLimiters(
    { count: config.instanceCount, backend, latency: config.latency, tokensPerJob: config.tokensPerJob },
    tracker
  );
  return { backend, tracker, instances, tpm: config.tpm, rpm: config.rpm, jpi: config.jobsPerInstance };
};
