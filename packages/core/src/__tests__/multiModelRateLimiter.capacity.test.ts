import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRICING,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  createDefaultResourceEstimations,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

type DefaultJobType = typeof DEFAULT_JOB_TYPE;

describe('MultiModelRateLimiter - hasCapacity true', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return true when any model has capacity', () => {
    limiter = createLLMRateLimiter({
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
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter.hasCapacity()).toBe(true);
  });
});

describe('MultiModelRateLimiter - hasCapacity false', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return false when all models are exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_LOW,
          pricing: DEFAULT_PRICING,
        },
        'gpt-3.5': {
          requestsPerMinute: RPM_LIMIT_LOW,
          pricing: DEFAULT_PRICING,
        },
      },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.hasCapacity()).toBe(false);
  });
});

describe('MultiModelRateLimiter - hasCapacityForModel', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  const highRpmConfig = {
    requestsPerMinute: RPM_LIMIT_HIGH,
    pricing: DEFAULT_PRICING,
  };
  const lowRpmConfig = {
    requestsPerMinute: RPM_LIMIT_LOW,
    pricing: DEFAULT_PRICING,
  };

  it('should return true for model with capacity', () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': highRpmConfig },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(true);
  });

  it('should return false for exhausted model', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': lowRpmConfig },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(false);
  });

  it('should throw error for unknown model', () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': highRpmConfig },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(() => limiter?.hasCapacityForModel('unknown-model')).toThrow('Unknown model: unknown-model');
  });
});

const highRpmModel = {
  requestsPerMinute: RPM_LIMIT_HIGH,
  pricing: DEFAULT_PRICING,
};
const lowRpmModel = {
  requestsPerMinute: RPM_LIMIT_LOW,
  pricing: DEFAULT_PRICING,
};

describe('MultiModelRateLimiter - getAvailableModel basic', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return first model in order when all have capacity', () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': highRpmModel, 'gpt-3.5': highRpmModel },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    expect(limiter.getAvailableModel()).toBe('gpt-4');
  });
});

describe('MultiModelRateLimiter - getAvailableModel exhausted', () => {
  let limiter: LLMRateLimiterInstance<DefaultJobType> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return next available model when first is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': lowRpmModel, 'gpt-3.5': highRpmModel },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.getAvailableModel()).toBe('gpt-3.5');
  });

  it('should return null when all models are exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': lowRpmModel, 'gpt-3.5': lowRpmModel },
      escalationOrder: ['gpt-4', 'gpt-3.5'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.getAvailableModel()).toBeNull();
  });
});
