import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance, QueueJobOptions } from '../multiModelTypes.js';
import {
  DEFAULT_PRICING,
  DELAY_MS_SHORT,
  ONE,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  createJobOptions,
  createMockJobResult,
  simpleJob,
  type MockJobResult,
} from './multiModelRateLimiter.helpers.js';

const MODEL_CFG_HIGH = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };
const MODEL_CFG_LOW = { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };

describe('MultiModelRateLimiter - order array', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should respect custom order priority', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_HIGH, 'gpt-3.5': MODEL_CFG_HIGH, claude: MODEL_CFG_HIGH },
      order: ['claude', 'gpt-3.5', 'gpt-4'],
    });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(result.modelUsed).toBe('claude');
  });
  it('should work with partial order (only some models)', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_LOW, 'gpt-3.5': MODEL_CFG_HIGH, claude: MODEL_CFG_HIGH },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result.modelUsed).toBe('gpt-3.5');
  });
});

describe('MultiModelRateLimiter - async job', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should execute async jobs correctly', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
    });
    const result = await limiter.queueJob(
      createJobOptions(async ({ modelId }) => {
        await setTimeoutAsync(DELAY_MS_SHORT);
        return { ...createMockJobResult(`async-${modelId}`), asyncFlag: true };
      })
    );
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.text).toBe('async-gpt-4');
    expect(result.asyncFlag).toBe(true);
  });
});

describe('MultiModelRateLimiter - no limits configured', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should work with models that have no limits', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { pricing: DEFAULT_PRICING }, 'gpt-3.5': { pricing: DEFAULT_PRICING } },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('no-limit-job')));
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.text).toBe('no-limit-job');
  });
});

describe('MultiModelRateLimiter - stop', () => {
  it('should stop all model limiters', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
        'gpt-3.5': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    limiter.stop();
  });
});

describe('MultiModelRateLimiter - use correct model ID in job callback', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should use correct model ID in job callback', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_LOW, 'gpt-3.5': MODEL_CFG_HIGH },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const receivedModelIds: string[] = [];
    const createTrackingJob = (name: string): QueueJobOptions<MockJobResult> => createJobOptions(({ modelId }) => { receivedModelIds.push(modelId); return createMockJobResult(name); });
    const job1 = await limiter.queueJob(createTrackingJob('job-0'));
    const job2 = await limiter.queueJob(createTrackingJob('job-1'));
    const job3 = await limiter.queueJob(createTrackingJob('job-2'));
    expect(job1.modelUsed).toBe('gpt-4');
    expect(job2.modelUsed).toBe('gpt-3.5');
    expect(job3.modelUsed).toBe('gpt-3.5');
  });
});
