/** Helper functions for Multi-Model Rate Limiter. */
import type { LLMRateLimiterConfig } from '../types.js';
import type { ModelsConfig, MultiModelRateLimiterConfig } from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;

const validateOrderArray = (order: readonly string[], models: ModelsConfig): void => {
  for (const modelId of order) {
    if (!(modelId in models)) {
      throw new Error(`Model '${modelId}' in order array is not defined in models`);
    }
  }
};

export const validateMultiModelConfig = (config: MultiModelRateLimiterConfig): void => {
  const modelIds = Object.keys(config.models);
  if (modelIds.length === ZERO) {
    throw new Error('At least one model must be configured in models');
  }
  if (config.order !== undefined) {
    validateOrderArray(config.order, config.models);
  }
  if (modelIds.length > ONE && config.order === undefined) {
    throw new Error('order is required when multiple models are configured');
  }
};

export const getEffectiveOrder = (config: MultiModelRateLimiterConfig): readonly string[] =>
  config.order ?? Object.keys(config.models);

export const buildModelLimiterConfig = (
  modelId: string,
  modelConfig: LLMRateLimiterConfig,
  parentLabel: string,
  onLog?: (message: string, data?: Record<string, unknown>) => void
): LLMRateLimiterConfig => ({
  requestsPerMinute: modelConfig.requestsPerMinute,
  requestsPerDay: modelConfig.requestsPerDay,
  tokensPerMinute: modelConfig.tokensPerMinute,
  tokensPerDay: modelConfig.tokensPerDay,
  maxConcurrentRequests: modelConfig.maxConcurrentRequests,
  resourcesPerEvent: modelConfig.resourcesPerEvent,
  label: `${parentLabel}/${modelId}`,
  onLog,
});
