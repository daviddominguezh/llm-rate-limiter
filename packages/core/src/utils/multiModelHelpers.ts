/** Helper functions for LLM Rate Limiter. */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { LLMRateLimiterConfig, ModelsConfig } from '../multiModelTypes.js';
import type { InternalLimiterConfig } from '../types.js';

const ZERO = 0;
const ONE = 1;

const validateEscalationOrder = (escalationOrder: readonly string[], models: ModelsConfig): void => {
  for (const modelId of escalationOrder) {
    if (!(modelId in models)) {
      throw new Error(`Model '${modelId}' in escalationOrder is not defined in models`);
    }
  }
};

export const validateMultiModelConfig = (config: LLMRateLimiterConfig): void => {
  const modelIds = Object.keys(config.models);
  if (modelIds.length === ZERO) {
    throw new Error('At least one model must be configured in models');
  }
  const { escalationOrder } = config;
  if (escalationOrder !== undefined) {
    validateEscalationOrder(escalationOrder, config.models);
  }
  if (modelIds.length > ONE && escalationOrder === undefined) {
    throw new Error('escalationOrder is required when multiple models are configured');
  }
};

/** Get effective escalation order */
export const getEffectiveOrder = (config: LLMRateLimiterConfig): readonly string[] =>
  config.escalationOrder ?? Object.keys(config.models);

/** Get resource estimations per job */
export const getEffectiveResourceEstimationsPerJob = (
  config: LLMRateLimiterConfig
): ResourceEstimationsPerJob => config.resourceEstimationsPerJob;

/** Estimated resources for internal limiter */
interface EstimatedResourcesInput {
  estimatedUsedMemoryKB: number;
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
}

export const buildModelLimiterConfig = (
  modelId: string,
  modelConfig: InternalLimiterConfig,
  parentLabel: string,
  onLog?: (message: string, data?: Record<string, unknown>) => void,
  estimatedResources?: EstimatedResourcesInput
): InternalLimiterConfig => ({
  requestsPerMinute: modelConfig.requestsPerMinute,
  requestsPerDay: modelConfig.requestsPerDay,
  tokensPerMinute: modelConfig.tokensPerMinute,
  tokensPerDay: modelConfig.tokensPerDay,
  maxConcurrentRequests: modelConfig.maxConcurrentRequests,
  label: `${parentLabel}/${modelId}`,
  onLog,
  estimatedNumberOfRequests: estimatedResources?.estimatedNumberOfRequests,
  estimatedUsedTokens: estimatedResources?.estimatedUsedTokens,
  estimatedUsedMemoryKB: estimatedResources?.estimatedUsedMemoryKB,
});
