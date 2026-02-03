import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  CONCURRENCY_LIMIT,
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  DELAY_MS_MEDIUM,
  ONE,
  RPM_LIMIT_HIGH,
  ZERO,
  createDefaultResourceEstimations,
  createJobOptions,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

type DefaultJobType = typeof DEFAULT_JOB_TYPE;

describe('MultiModelRateLimiter - getModelStats', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  const modelConfig = {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  };

  it('should return stats for specific model', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': modelConfig, 'gpt-3.5': modelConfig },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.getModelStats('gpt-4').requestsPerMinute?.current).toBe(ONE);
    expect(limiter.getModelStats('gpt-3.5').requestsPerMinute?.current).toBe(ZERO);
  });

  it('should throw error for unknown model', () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': modelConfig },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(() => limiter?.getModelStats('unknown-model')).toThrow('Unknown model: unknown-model');
  });
});

describe('MultiModelRateLimiter - queueJobForModel', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  const cfg = {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  };

  it('should execute job on specified model', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': cfg, 'gpt-3.5': cfg },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    const result = await limiter.queueJobForModel('gpt-3.5', () => createMockJobResult('specific-model-job'));
    expect(result.text).toBe('specific-model-job');
    const { models } = limiter.getStats();
    const { 'gpt-3.5': gpt35Stats, 'gpt-4': gpt4Stats } = models;
    expect(gpt35Stats).toBeDefined();
    expect(gpt4Stats).toBeDefined();
    if (gpt35Stats !== undefined) {
      expect(gpt35Stats.requestsPerMinute?.current).toBe(ONE);
    }
    if (gpt4Stats !== undefined) {
      expect(gpt4Stats.requestsPerMinute?.current).toBe(ZERO);
    }
  });

  it('should throw error for unknown model', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': cfg },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await expect(
      limiter.queueJobForModel('unknown-model', () => createMockJobResult('test'))
    ).rejects.toThrow('Unknown model');
  });
});

describe('MultiModelRateLimiter - concurrency', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should respect per-model concurrency limits', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: DEFAULT_PRICING } },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let concurrentCount = ZERO;
    let maxConcurrent = ZERO;
    const concurrentJob = createJobOptions(async () => {
      concurrentCount += ONE;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await setTimeoutAsync(DELAY_MS_MEDIUM);
      concurrentCount -= ONE;
      return createMockJobResult('concurrent-job');
    });
    const jobs = [
      limiter.queueJob(concurrentJob),
      limiter.queueJob(concurrentJob),
      limiter.queueJob(concurrentJob),
      limiter.queueJob(concurrentJob),
    ];
    await Promise.all(jobs);
    expect(maxConcurrent).toBe(CONCURRENCY_LIMIT);
  });
});
