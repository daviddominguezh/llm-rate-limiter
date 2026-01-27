import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createMultiModelRateLimiter } from '../multiModelRateLimiter.js';

import type { MultiModelRateLimiterInstance } from '../multiModelTypes.js';
import { createJobOptions, createMockJobResult, DELAY_MS_SHORT, ONE, RPM_LIMIT_HIGH, RPM_LIMIT_LOW, simpleJob } from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - single model', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should create limiter with single model (order optional)', () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } } },
    });
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
  });

  it('should execute job on single model', async () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } } },
    });
    const result = await limiter.queueJob(createJobOptions(({ modelId }) => {
      expect(modelId).toBe('gpt-4');
      return createMockJobResult('test-result');
    }));
    expect(result.text).toBe('test-result');
    expect(result.modelUsed).toBe('gpt-4');
  });

  it('should return correct stats for single model', async () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } } },
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const { models } = limiter.getStats();
    const { 'gpt-4': gpt4Stats } = models;
    expect(gpt4Stats).toBeDefined();
    if (gpt4Stats !== undefined) { expect(gpt4Stats.requestsPerMinute?.current).toBe(ONE); }
  });
});

describe('MultiModelRateLimiter - multiple models create', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should create limiter with multiple models (order required)', () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
  });
});

describe('MultiModelRateLimiter - multiple models execute', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should execute job on first model in order', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result = await limiter.queueJob(createJobOptions(({ modelId }) => {
      expect(modelId).toBe('gpt-4');
      return createMockJobResult('test-result');
    }));
    expect(result.modelUsed).toBe('gpt-4');
  });

  it('should return correct stats for multiple models', () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const stats = limiter.getStats();
    expect(stats.models['gpt-4']).toBeDefined();
    expect(stats.models['gpt-3.5']).toBeDefined();
  });
});

describe('MultiModelRateLimiter - order array', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should respect custom order priority', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'claude': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['claude', 'gpt-3.5', 'gpt-4'],
    });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(result.modelUsed).toBe('claude');
  });

  it('should work with partial order (only some models)', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'claude': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result.modelUsed).toBe('gpt-3.5');
  });
});

describe('MultiModelRateLimiter - async job', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should execute async jobs correctly', async () => {
    limiter = createMultiModelRateLimiter({
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } } },
    });
    const result = await limiter.queueJob(createJobOptions(async ({ modelId }) => {
      await setTimeoutAsync(DELAY_MS_SHORT);
      return { ...createMockJobResult(`async-${String(modelId)}`), asyncFlag: true };
    }));
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.text).toBe('async-gpt-4');
    expect(result.asyncFlag).toBe(true);
  });
});

describe('MultiModelRateLimiter - no limits configured', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should work with models that have no limits', async () => {
    limiter = createMultiModelRateLimiter({ models: { 'gpt-4': {}, 'gpt-3.5': {} }, order: ['gpt-4', 'gpt-3.5'] });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('no-limit-job')));
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.text).toBe('no-limit-job');
  });
});

describe('MultiModelRateLimiter - stop', () => {
  it('should stop all model limiters', async () => {
    const limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    limiter.stop();
  });
});

describe('MultiModelRateLimiter - use correct model ID in job callback', () => {
  let limiter: MultiModelRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should use correct model ID in job callback', async () => {
    limiter = createMultiModelRateLimiter({
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE } },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const receivedModelIds: string[] = [];
    const job1 = await limiter.queueJob(createJobOptions(({ modelId }) => { receivedModelIds.push(modelId); return createMockJobResult('job-0'); }));
    const job2 = await limiter.queueJob(createJobOptions(({ modelId }) => { receivedModelIds.push(modelId); return createMockJobResult('job-1'); }));
    const job3 = await limiter.queueJob(createJobOptions(({ modelId }) => { receivedModelIds.push(modelId); return createMockJobResult('job-2'); }));
    expect(job1.modelUsed).toBe('gpt-4');
    expect(job2.modelUsed).toBe('gpt-3.5');
    expect(job3.modelUsed).toBe('gpt-3.5');
  });
});
