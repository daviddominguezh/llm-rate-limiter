import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  ONE,
  RPM_LIMIT_HIGH,
  createDefaultResourceEstimations,
  createJobOptions,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

type DefaultJobType = typeof DEFAULT_JOB_TYPE;

const SINGLE_MODEL_CONFIG = {
  'gpt-4': {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  },
};

const DEFAULT_RESOURCES = createDefaultResourceEstimations();

describe('MultiModelRateLimiter - single model', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should create limiter with single model (order optional)', () => {
    limiter = createLLMRateLimiter({
      models: SINGLE_MODEL_CONFIG,
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
  });
  it('should execute job on single model', async () => {
    limiter = createLLMRateLimiter({
      models: SINGLE_MODEL_CONFIG,
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const result = await limiter.queueJob(
      createJobOptions(
        ({ modelId }) => {
          expect(modelId).toBe('gpt-4');
          return createMockJobResult('test-result');
        },
        undefined,
        DEFAULT_JOB_TYPE
      )
    );
    expect(result.text).toBe('test-result');
    expect(result.modelUsed).toBe('gpt-4');
  });
  it('should return correct stats for single model', async () => {
    limiter = createLLMRateLimiter({
      models: SINGLE_MODEL_CONFIG,
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1'), DEFAULT_JOB_TYPE));
    const { models } = limiter.getStats();
    const { 'gpt-4': gpt4Stats } = models;
    expect(gpt4Stats).toBeDefined();
    if (gpt4Stats !== undefined) {
      expect(gpt4Stats.requestsPerMinute?.current).toBe(ONE);
    }
  });
});

const MULTI_MODEL_CONFIG = {
  'gpt-4': {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  },
  'gpt-3.5': {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  },
};

describe('MultiModelRateLimiter - multiple models', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should create limiter with multiple models (order required)', () => {
    limiter = createLLMRateLimiter({
      models: MULTI_MODEL_CONFIG,
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    expect(limiter).toBeDefined();
    expect(limiter.hasCapacity()).toBe(true);
  });
  it('should execute job on first model in order', async () => {
    limiter = createLLMRateLimiter({
      models: MULTI_MODEL_CONFIG,
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const result = await limiter.queueJob(
      createJobOptions(
        ({ modelId }) => {
          expect(modelId).toBe('gpt-4');
          return createMockJobResult('test-result');
        },
        undefined,
        DEFAULT_JOB_TYPE
      )
    );
    expect(result.modelUsed).toBe('gpt-4');
  });
  it('should return correct stats for multiple models', () => {
    limiter = createLLMRateLimiter({
      models: MULTI_MODEL_CONFIG,
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: DEFAULT_RESOURCES,
    });
    const stats = limiter.getStats();
    expect(stats.models['gpt-4']).toBeDefined();
    expect(stats.models['gpt-3.5']).toBeDefined();
  });
});
