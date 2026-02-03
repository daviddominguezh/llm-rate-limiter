/** Helper functions for LLM Rate Limiter. */
import type { ResourcesPerJob } from '../jobTypeTypes.js';
import type { LLMRateLimiterConfig, ModelsConfig } from '../multiModelTypes.js';
import type { InternalLimiterConfig } from '../types.js';

const ZERO = 0;
const ONE = 1;

const validateOrderArray = (order: readonly string[], models: ModelsConfig): void => {
  for (const modelId of order) {
    if (!(modelId in models)) {
      throw new Error(`Model '${modelId}' in order array is not defined in models`);
    }
  }
};

/** Get order from config (supports both 'order' and 'escalationOrder' aliases) */
const getOrderFromConfig = (config: LLMRateLimiterConfig): readonly string[] | undefined =>
  config.order ?? config.escalationOrder;

export const validateMultiModelConfig = (config: LLMRateLimiterConfig): void => {
  const modelIds = Object.keys(config.models);
  if (modelIds.length === ZERO) {
    throw new Error('At least one model must be configured in models');
  }
  const order = getOrderFromConfig(config);
  if (order !== undefined) {
    validateOrderArray(order, config.models);
  }
  if (modelIds.length > ONE && order === undefined) {
    throw new Error('order (or escalationOrder) is required when multiple models are configured');
  }
};

/** Get effective order (supports both 'order' and 'escalationOrder' aliases) */
export const getEffectiveOrder = (config: LLMRateLimiterConfig): readonly string[] =>
  getOrderFromConfig(config) ?? Object.keys(config.models);

/** Get resourcesPerJob (supports both 'resourcesPerJob' and 'estimates' aliases) */
export const getEffectiveResourcesPerJob = (config: LLMRateLimiterConfig): ResourcesPerJob | undefined =>
  config.resourcesPerJob ?? config.estimates;

export const buildModelLimiterConfig = (
  modelId: string,
  modelConfig: InternalLimiterConfig,
  parentLabel: string,
  onLog?: (message: string, data?: Record<string, unknown>) => void
): InternalLimiterConfig => ({
  requestsPerMinute: modelConfig.requestsPerMinute,
  requestsPerDay: modelConfig.requestsPerDay,
  tokensPerMinute: modelConfig.tokensPerMinute,
  tokensPerDay: modelConfig.tokensPerDay,
  maxConcurrentRequests: modelConfig.maxConcurrentRequests,
  label: `${parentLabel}/${modelId}`,
  onLog,
});
