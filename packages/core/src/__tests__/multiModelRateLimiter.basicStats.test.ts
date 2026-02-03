import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { ArgsWithoutModelId, LLMRateLimiterInstance, QueueJobOptions } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  DELAY_MS_SHORT,
  type MockJobResult,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  createDefaultResourceEstimations,
  createJobOptions,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

const DEFAULT_RESOURCES = createDefaultResourceEstimations();

const MODEL_CFG_HIGH = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: DEFAULT_PRICING,
};
const MODEL_CFG_LOW = {
  requestsPerMinute: RPM_LIMIT_LOW,
  pricing: DEFAULT_PRICING,
};

describe('MultiModelRateLimiter - order array', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should respect custom order priority', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_HIGH, 'gpt-3.5': MODEL_CFG_HIGH, claude: MODEL_CFG_HIGH },
      escalationOrder: ['claude', 'gpt-3.5', 'gpt-4'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(result.modelUsed).toBe('claude');
  });
  it('should work with partial order (only some models)', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_LOW, 'gpt-3.5': MODEL_CFG_HIGH, claude: MODEL_CFG_HIGH },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    const result = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result.modelUsed).toBe('gpt-3.5');
  });
});

describe('MultiModelRateLimiter - async job', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should execute async jobs correctly', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          pricing: DEFAULT_PRICING,
        },
      },
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const jobOptions = createJobOptions(
      async ({ modelId }) => {
        await setTimeoutAsync(DELAY_MS_SHORT);
        return { ...createMockJobResult(`async-${modelId}`), asyncFlag: true };
      },
      undefined,
      DEFAULT_JOB_TYPE
    );
    const result = await limiter.queueJob({
      ...jobOptions,
      jobType: DEFAULT_JOB_TYPE,
    });
    expect(result.modelUsed).toBe('gpt-4');
    expect(result.text).toBe('async-gpt-4');
    expect(result.asyncFlag).toBe(true);
  });
});

describe('MultiModelRateLimiter - no limits configured', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should work with models that have no limits', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { pricing: DEFAULT_PRICING }, 'gpt-3.5': { pricing: DEFAULT_PRICING } },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
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
          pricing: DEFAULT_PRICING,
        },
        'gpt-3.5': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          pricing: DEFAULT_PRICING,
        },
      },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    limiter.stop();
  });
});

describe('MultiModelRateLimiter - use correct model ID in job callback', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should use correct model ID in job callback', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': MODEL_CFG_LOW, 'gpt-3.5': MODEL_CFG_HIGH },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const receivedModelIds: string[] = [];
    const createTrackingJob = (
      name: string
    ): QueueJobOptions<MockJobResult, ArgsWithoutModelId, 'default'> => {
      const baseOptions = createJobOptions(({ modelId }) => {
        receivedModelIds.push(modelId);
        return createMockJobResult(name);
      });
      return { ...baseOptions, jobType: DEFAULT_JOB_TYPE };
    };
    const job1 = await limiter.queueJob(createTrackingJob('job-0'));
    const job2 = await limiter.queueJob(createTrackingJob('job-1'));
    const job3 = await limiter.queueJob(createTrackingJob('job-2'));
    expect(job1.modelUsed).toBe('gpt-4');
    expect(job2.modelUsed).toBe('gpt-3.5');
    expect(job3.modelUsed).toBe('gpt-3.5');
  });
});
