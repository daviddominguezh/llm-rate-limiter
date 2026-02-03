/**
 * Configuration validation utilities for LLM Rate Limiter.
 * Resource estimates are now at the job type level (resourcesPerJob), not at the model level.
 */
import type { InternalLimiterConfig } from '../types.js';

/**
 * Validates the LLM Rate Limiter configuration.
 * Resource validation has moved to the job type level (resourcesPerJob).
 */
export const validateConfig = (_config: InternalLimiterConfig): void => {
  // No validation needed at model level - resource estimates are now at job type level
};
