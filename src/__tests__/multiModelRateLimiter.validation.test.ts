import { createLLMRateLimiter } from '../multiModelRateLimiter.js';

import type { LLMRateLimiterConfig } from '../multiModelTypes.js';
import { DEFAULT_PRICING, ONE, RPM_LIMIT_HIGH } from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - validation empty models', () => {
  it('should throw error for empty models', () => {
    const invalidConfig: LLMRateLimiterConfig = { models: {} };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow('At least one model must be configured in models');
  });
});

describe('MultiModelRateLimiter - validation undefined model in order', () => {
  it('should throw error when order contains undefined model', () => {
    const invalidConfig: LLMRateLimiterConfig = {
      models: { 'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING } },
      order: ['gpt-4', 'undefined-model'],
    };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow("Model 'undefined-model' in order array is not defined in models");
  });
});

describe('MultiModelRateLimiter - validation missing order', () => {
  it('should throw error when multiple models but no order', () => {
    const invalidConfig: LLMRateLimiterConfig = {
      models: {
        'gpt-4': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { requestsPerMinute: RPM_LIMIT_HIGH, resourcesPerEvent: { estimatedNumberOfRequests: ONE }, pricing: DEFAULT_PRICING },
      },
    };
    expect(() => createLLMRateLimiter(invalidConfig)).toThrow('order is required when multiple models are configured');
  });
});
