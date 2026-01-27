import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createMultiModelRateLimiter } from '../multiModelRateLimiter.js';

import type { MultiModelRateLimiterInstance } from '../multiModelTypes.js';
import { CONCURRENCY_LIMIT, createJobOptions, createMockJobResult, DEFAULT_PRICING, DELAY_MS_MEDIUM, ONE, RPM_LIMIT_HIGH, RPM_LIMIT_LOW, simpleJob, ZERO } from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - hasCapacity true', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return true when any model has capacity', () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    expect(limiter.hasCapacity()).toBe(true);
  });
});

describe('MultiModelRateLimiter - hasCapacity false', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return false when all models are exhausted', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.hasCapacity()).toBe(false);
  });
});

describe('MultiModelRateLimiter - hasCapacityForModel', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return true for model with capacity', () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
    });
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(true);
  });

  it('should return false for exhausted model', async () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(false);
  });

  it('should throw error for unknown model', () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
    });
    expect(() => limiter?.hasCapacityForModel('unknown-model')).toThrow('Unknown model: unknown-model');
  });
});

describe('MultiModelRateLimiter - getAvailableModel', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return first model in order when all have capacity', () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    expect(limiter.getAvailableModel()).toBe('gpt-4');
  });

  it('should return next available model when first is exhausted', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.getAvailableModel()).toBe('gpt-3.5');
  });

  it('should return null when all models are exhausted', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.getAvailableModel()).toBeNull();
  });
});

describe('MultiModelRateLimiter - getModelStats', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should return stats for specific model', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const gpt4Stats = limiter.getModelStats('gpt-4');
    expect(gpt4Stats.requestsPerMinute?.current).toBe(ONE);
    const gpt35Stats = limiter.getModelStats('gpt-3.5');
    expect(gpt35Stats.requestsPerMinute?.current).toBe(ZERO);
  });

  it('should throw error for unknown model', () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
    });
    expect(() => limiter?.getModelStats('unknown-model')).toThrow('Unknown model: unknown-model');
  });
});

describe('MultiModelRateLimiter - queueJobForModel', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should execute job on specified model', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result = await limiter.queueJobForModel('gpt-3.5', () => createMockJobResult('specific-model-job'));
    expect(result.text).toBe('specific-model-job');
    const { models } = limiter.getStats();
    const { 'gpt-3.5': gpt35Stats, 'gpt-4': gpt4Stats } = models;
    expect(gpt35Stats).toBeDefined();
    expect(gpt4Stats).toBeDefined();
    if (gpt35Stats !== undefined) { expect(gpt35Stats.requestsPerMinute?.current).toBe(ONE); }
    if (gpt4Stats !== undefined) { expect(gpt4Stats.requestsPerMinute?.current).toBe(ZERO); }
  });

  it('should throw error for unknown model', async () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
    });
    await expect(limiter.queueJobForModel('unknown-model', () => createMockJobResult('test'))).rejects.toThrow('Unknown model');
  });
});

describe('MultiModelRateLimiter - concurrency', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should respect per-model concurrency limits', async () => {
    limiter = createMultiModelRateLimiter({ models: { 'gpt-4': { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: DEFAULT_PRICING } } });
    let concurrentCount = ZERO;
    let maxConcurrent = ZERO;
    const concurrentJob = createJobOptions(async () => {
      concurrentCount += ONE;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await setTimeoutAsync(DELAY_MS_MEDIUM);
      concurrentCount -= ONE;
      return createMockJobResult('concurrent-job');
    });
    const jobs = [limiter.queueJob(concurrentJob), limiter.queueJob(concurrentJob), limiter.queueJob(concurrentJob), limiter.queueJob(concurrentJob)];
    await Promise.all(jobs);
    expect(maxConcurrent).toBe(CONCURRENCY_LIMIT);
  });
});
