/**
 * Allocation calculation helpers for distributed rate limiting.
 */
import type { AllocationInfo, ModelRateLimitConfig } from '../multiModelTypes.js';
import type { InternalLimiterInstance, RateLimitUpdate } from '../types.js';

const ZERO = 0;

interface PerInstanceLimits {
  tokensPerMinute: number | undefined;
  requestsPerMinute: number | undefined;
  tokensPerDay: number | undefined;
  requestsPerDay: number | undefined;
  maxConcurrentRequests: number | undefined;
}

interface AllocationParams {
  modelId: string;
  modelConfig: ModelRateLimitConfig;
  allocation: AllocationInfo;
}

const calculateLimitValue = (
  dynamicValue: number | undefined,
  configValue: number | undefined,
  instanceCount: number
): number | undefined => {
  if (dynamicValue !== undefined) {
    if (configValue !== undefined) {
      const baseAllocation = Math.floor(configValue / instanceCount);
      return Math.max(dynamicValue, baseAllocation);
    }
    return dynamicValue;
  }
  if (configValue !== undefined) {
    return Math.floor(configValue / instanceCount);
  }
  return undefined;
};

/**
 * Calculate per-instance limits for a specific model.
 */
export const calculatePerInstanceLimits = (params: AllocationParams): PerInstanceLimits => {
  const { modelId, modelConfig, allocation } = params;
  const { instanceCount, dynamicLimits } = allocation;
  const modelDynamic = dynamicLimits?.[modelId];

  return {
    tokensPerMinute: calculateLimitValue(
      modelDynamic?.tokensPerMinute,
      modelConfig.tokensPerMinute,
      instanceCount
    ),
    requestsPerMinute: calculateLimitValue(
      modelDynamic?.requestsPerMinute,
      modelConfig.requestsPerMinute,
      instanceCount
    ),
    tokensPerDay: calculateLimitValue(modelDynamic?.tokensPerDay, modelConfig.tokensPerDay, instanceCount),
    requestsPerDay: calculateLimitValue(
      modelDynamic?.requestsPerDay,
      modelConfig.requestsPerDay,
      instanceCount
    ),
    maxConcurrentRequests: calculateLimitValue(undefined, modelConfig.maxConcurrentRequests, instanceCount),
  };
};

/**
 * Check if allocation should be skipped due to invalid or stale instance count.
 */
export const shouldSkipAllocation = (instanceCount: number, currentInstanceCount: number): boolean =>
  instanceCount <= ZERO || instanceCount < currentInstanceCount;

/**
 * Apply calculated limits to a limiter instance.
 */
export const applyLimitsToLimiter = (limiter: InternalLimiterInstance, limits: PerInstanceLimits): void => {
  const rateLimits: RateLimitUpdate = {
    tokensPerMinute: limits.tokensPerMinute,
    requestsPerMinute: limits.requestsPerMinute,
    tokensPerDay: limits.tokensPerDay,
    requestsPerDay: limits.requestsPerDay,
  };
  limiter.setRateLimits(rateLimits);
  if (limits.maxConcurrentRequests !== undefined) {
    limiter.setConcurrencyLimit(limits.maxConcurrentRequests);
  }
};
