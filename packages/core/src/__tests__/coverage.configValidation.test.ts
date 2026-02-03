/**
 * Coverage tests for configValidation module.
 * Resource validation has moved to the job type level (resourcesPerJob).
 */
import type { InternalLimiterConfig } from '../types.js';
import { validateConfig } from '../utils/configValidation.js';
import { HUNDRED } from './coverage.helpers.js';

describe('configValidation - validateConfig', () => {
  it('should pass validateConfig with any config (no validation at model level)', () => {
    const config: InternalLimiterConfig = {
      requestsPerMinute: HUNDRED,
      tokensPerMinute: HUNDRED,
    };
    expect(() => {
      validateConfig(config);
    }).not.toThrow();
  });
});
