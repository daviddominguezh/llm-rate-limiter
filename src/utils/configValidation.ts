/**
 * Configuration validation utilities for LLM Rate Limiter.
 */
import type { LLMRateLimiterConfig } from '../types.js';

const ZERO = 0;

type ResourcesPerEvent = LLMRateLimiterConfig['resourcesPerEvent'];

/**
 * Validates that request limits have the required resourcesPerEvent fields.
 */
export const validateRequestLimits = (config: LLMRateLimiterConfig, resources: ResourcesPerEvent): void => {
  const hasRequestLimit = config.requestsPerMinute !== undefined || config.requestsPerDay !== undefined;
  const hasValidEstimate = resources?.estimatedNumberOfRequests !== undefined && resources.estimatedNumberOfRequests > ZERO;
  if (hasRequestLimit && !hasValidEstimate) {
    throw new Error(
      'resourcesPerEvent.estimatedNumberOfRequests is required when requestsPerMinute or requestsPerDay is configured. ' +
        'This ensures request limits are never exceeded by reserving requests before job execution.'
    );
  }
};

/**
 * Validates that token limits have the required resourcesPerEvent fields.
 */
export const validateTokenLimits = (config: LLMRateLimiterConfig, resources: ResourcesPerEvent): void => {
  const hasTokenLimit = config.tokensPerMinute !== undefined || config.tokensPerDay !== undefined;
  const hasValidEstimate = resources?.estimatedUsedTokens !== undefined && resources.estimatedUsedTokens > ZERO;
  if (hasTokenLimit && !hasValidEstimate) {
    throw new Error(
      'resourcesPerEvent.estimatedUsedTokens is required when tokensPerMinute or tokensPerDay is configured. ' +
        'This ensures token limits are never exceeded by reserving tokens before job execution.'
    );
  }
};

/**
 * Validates that memory limits have the required resourcesPerEvent fields.
 */
export const validateMemoryLimits = (config: LLMRateLimiterConfig, resources: ResourcesPerEvent): void => {
  const hasValidEstimate = resources?.estimatedUsedMemoryKB !== undefined && resources.estimatedUsedMemoryKB > ZERO;
  if (config.memory !== undefined && !hasValidEstimate) {
    throw new Error(
      'resourcesPerEvent.estimatedUsedMemoryKB is required when memory limits are configured. ' +
        'This ensures memory limits are respected by reserving memory before job execution.'
    );
  }
};

/**
 * Validates the entire LLM Rate Limiter configuration.
 */
export const validateConfig = (config: LLMRateLimiterConfig): void => {
  const { resourcesPerEvent: resources } = config;
  validateRequestLimits(config, resources);
  validateTokenLimits(config, resources);
  validateMemoryLimits(config, resources);
};
