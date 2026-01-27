import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import {
  DEFAULT_PRICING,
  ONE,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - hasCapacity true', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return true when any model has capacity', () => {
    limiter = createLLMRateLimiter({
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
    expect(limiter.hasCapacity()).toBe(true);
  });
});

describe('MultiModelRateLimiter - hasCapacity false', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should return false when all models are exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_LOW,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
        'gpt-3.5': {
          requestsPerMinute: RPM_LIMIT_LOW,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.hasCapacity()).toBe(false);
  });
});

describe('MultiModelRateLimiter - hasCapacityForModel', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });
  const highRpmConfig = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };
  const lowRpmConfig = { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };

  it('should return true for model with capacity', () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': highRpmConfig } });
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(true);
  });

  it('should return false for exhausted model', async () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': lowRpmConfig } });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.hasCapacityForModel('gpt-4')).toBe(false);
  });

  it('should throw error for unknown model', () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': highRpmConfig } });
    expect(() => limiter?.hasCapacityForModel('unknown-model')).toThrow('Unknown model: unknown-model');
  });
});

describe('MultiModelRateLimiter - getAvailableModel', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });
  const highRpm = { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };
  const lowRpm = { requestsPerMinute: RPM_LIMIT_LOW, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING };

  it('should return first model in order when all have capacity', () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': highRpm, 'gpt-3.5': highRpm }, order: ['gpt-4', 'gpt-3.5'] });
    expect(limiter.getAvailableModel()).toBe('gpt-4');
  });

  it('should return next available model when first is exhausted', async () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': lowRpm, 'gpt-3.5': highRpm }, order: ['gpt-4', 'gpt-3.5'] });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.getAvailableModel()).toBe('gpt-3.5');
  });

  it('should return null when all models are exhausted', async () => {
    limiter = createLLMRateLimiter({ models: { 'gpt-4': lowRpm, 'gpt-3.5': lowRpm }, order: ['gpt-4', 'gpt-3.5'] });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(limiter.getAvailableModel()).toBeNull();
  });
});
