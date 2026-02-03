/**
 * Initialization helpers for the LLM Rate Limiter.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { LLMRateLimiterConfig, LLMRateLimiterStats, ModelRateLimitConfig } from '../multiModelTypes.js';
import { createInternalLimiter } from '../rateLimiter.js';
import type {
  InternalLimiterConfig,
  InternalLimiterInstance,
  InternalLimiterStats,
  LogFn,
} from '../types.js';
import { AvailabilityTracker } from './availabilityTracker.js';
import { calculateMaxEstimatedResource } from './jobExecutionHelpers.js';
import { buildModelLimiterConfig } from './multiModelHelpers.js';

/** Estimated resources configuration */
export interface EstimatedResources {
  estimatedUsedMemoryKB: number;
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
}

/** Calculate all estimated resources from resourceEstimationsPerJob config */
export const calculateEstimatedResources = (
  resourceEstimationsPerJob: ResourceEstimationsPerJob
): EstimatedResources => ({
  estimatedUsedMemoryKB: calculateMaxEstimatedResource(
    resourceEstimationsPerJob,
    (j) => j.estimatedUsedMemoryKB
  ),
  estimatedUsedTokens: calculateMaxEstimatedResource(resourceEstimationsPerJob, (j) => j.estimatedUsedTokens),
  estimatedNumberOfRequests: calculateMaxEstimatedResource(
    resourceEstimationsPerJob,
    (j) => j.estimatedNumberOfRequests
  ),
});

/** Create availability tracker if callback is configured */
export const createAvailabilityTracker = (
  config: LLMRateLimiterConfig,
  estimatedResources: EstimatedResources,
  getStats: () => LLMRateLimiterStats
): AvailabilityTracker | null => {
  if (config.onAvailableSlotsChange === undefined) {
    return null;
  }
  const tracker = new AvailabilityTracker({
    callback: config.onAvailableSlotsChange,
    getStats,
    estimatedResources,
  });
  tracker.initialize();
  return tracker;
};

/** Initialize model limiters from config */
export const initializeModelLimiters = (
  models: Record<string, ModelRateLimitConfig>,
  label: string,
  onLog: LogFn | undefined,
  estimatedResources?: EstimatedResources
): Map<string, InternalLimiterInstance> => {
  const limiters = new Map<string, InternalLimiterInstance>();
  for (const [modelId, modelConfig] of Object.entries(models)) {
    const limiterConfig = buildModelLimiterConfig(
      modelId,
      modelConfig as InternalLimiterConfig,
      label,
      onLog,
      estimatedResources
    );
    limiters.set(modelId, createInternalLimiter(limiterConfig));
  }
  return limiters;
};

/** Get model limiter by ID, throws if not found */
export const getModelLimiterById = (
  limiters: Map<string, InternalLimiterInstance>,
  modelId: string
): InternalLimiterInstance => {
  const limiter = limiters.get(modelId);
  if (limiter === undefined) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return limiter;
};

/** Build model stats from limiters */
export const buildModelStats = (
  limiters: Map<string, InternalLimiterInstance>
): Record<string, InternalLimiterStats> => {
  const modelStats: Record<string, InternalLimiterStats> = {};
  for (const [modelId, limiter] of limiters) {
    modelStats[modelId] = limiter.getStats();
  }
  return modelStats;
};

const ZERO = 0;
const DEFAULT_JOB_TYPE_CAPACITY = 100;

/** Calculate total capacity for job types from models config.
 * Uses the sum of maxConcurrentRequests across all models,
 * since jobs can run on any available model. */
export const calculateJobTypeCapacity = (models: Record<string, ModelRateLimitConfig>): number => {
  let totalCapacity = ZERO;
  for (const modelConfig of Object.values(models)) {
    const { maxConcurrentRequests } = modelConfig;
    if (typeof maxConcurrentRequests === 'number' && maxConcurrentRequests > ZERO) {
      totalCapacity += maxConcurrentRequests;
    }
  }
  return totalCapacity > ZERO ? totalCapacity : DEFAULT_JOB_TYPE_CAPACITY;
};
