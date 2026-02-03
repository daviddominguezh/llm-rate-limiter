import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterConfig } from '../multiModelTypes.js';
import {
  DEFAULT_PRICING,
  RPM_LIMIT_HIGH,
  createDefaultResourceEstimations,
} from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - validation empty models', () => {
  it('should throw error for empty models', () => {
    const invalidConfig: LLMRateLimiterConfig = {
      models: {},
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow(
      'At least one model must be configured in models'
    );
  });
});

describe('MultiModelRateLimiter - validation undefined model in order', () => {
  it('should throw error when order contains undefined model', () => {
    const invalidConfig: LLMRateLimiterConfig = {
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          pricing: DEFAULT_PRICING,
        },
      },
      escalationOrder: ['gpt-4', 'undefined-model'],
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow(
      "Model 'undefined-model' in escalationOrder is not defined in models"
    );
  });
});

describe('MultiModelRateLimiter - validation missing order', () => {
  it('should throw error when multiple models but no order', () => {
    const invalidConfig: LLMRateLimiterConfig = {
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
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow(
      'escalationOrder is required when multiple models are configured'
    );
  });
});
