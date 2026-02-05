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
  OverageFn,
} from '../types.js';
import { AvailabilityTracker, type ModelCapacityBounds } from './availabilityTracker.js';
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

/** Extract capacity bounds (minCapacity/maxCapacity) from model configs */
export const extractModelCapacityBounds = (
  models: Record<string, ModelRateLimitConfig>
): ModelCapacityBounds => {
  const bounds: ModelCapacityBounds = {};
  for (const [modelId, modelConfig] of Object.entries(models)) {
    const { minCapacity, maxCapacity } = modelConfig;
    if (minCapacity !== undefined || maxCapacity !== undefined) {
      bounds[modelId] = { minCapacity, maxCapacity };
    }
  }
  return bounds;
};

/** Create availability tracker if callback is configured */
export const createAvailabilityTracker = (
  config: LLMRateLimiterConfig,
  estimatedResources: EstimatedResources,
  getStats: () => LLMRateLimiterStats
): AvailabilityTracker | null => {
  if (config.onAvailableSlotsChange === undefined) {
    return null;
  }
  const modelCapacityBounds = extractModelCapacityBounds(config.models);
  const tracker = new AvailabilityTracker({
    callback: config.onAvailableSlotsChange,
    getStats,
    estimatedResources,
    resourceEstimationsPerJob: config.resourceEstimationsPerJob,
    modelCapacityBounds,
  });
  tracker.initialize();
  return tracker;
};

/** Initialize model limiters from config */
export const initializeModelLimiters = (
  models: Record<string, ModelRateLimitConfig>,
  label: string,
  onLog: LogFn | undefined,
  estimatedResources?: EstimatedResources,
  onOverage?: OverageFn
): Map<string, InternalLimiterInstance> => {
  const limiters = new Map<string, InternalLimiterInstance>();
  for (const [modelId, modelConfig] of Object.entries(models)) {
    const limiterConfig = buildModelLimiterConfig({
      modelId,
      modelConfig: modelConfig as InternalLimiterConfig,
      parentLabel: label,
      onLog,
      onOverage,
      estimatedResources,
    });
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
const ONE = 1;
const DEFAULT_JOB_TYPE_CAPACITY = 100;
const DEFAULT_TOKENS_PER_JOB = 1000;

/** Calculate average estimated tokens per job from resource estimations */
const calculateAverageTokensPerJob = (
  resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined
): number => {
  if (resourceEstimationsPerJob === undefined) {
    return DEFAULT_TOKENS_PER_JOB;
  }
  const jobTypes = Object.values(resourceEstimationsPerJob);
  if (jobTypes.length === ZERO) {
    return DEFAULT_TOKENS_PER_JOB;
  }
  const totalTokens = jobTypes.reduce((sum, job) => sum + (job.estimatedUsedTokens ?? ZERO), ZERO);
  const avgTokens = totalTokens / jobTypes.length;
  return avgTokens > ZERO ? avgTokens : DEFAULT_TOKENS_PER_JOB;
};

/** Calculate concurrent capacity from TPM-based limits.
 * Estimates how many jobs can run concurrently based on tokens per minute
 * and average tokens per job. Uses a conservative factor since jobs
 * don't complete instantly. */
const calculateTpmBasedCapacity = (tokensPerMinute: number, avgTokensPerJob: number): number => {
  // Estimate: TPM / tokens per job gives theoretical max concurrent jobs
  // A job using avgTokensPerJob tokens can run TPM/avgTokensPerJob times per minute
  // For concurrent capacity, we use this as an upper bound
  return Math.floor(tokensPerMinute / avgTokensPerJob);
};

/** Calculate total capacity for job types from models config.
 * Uses the sum of maxConcurrentRequests across all models.
 * For models without maxConcurrentRequests but with tokensPerMinute,
 * estimates concurrent capacity from TPM and average tokens per job. */
export const calculateJobTypeCapacity = (
  models: Record<string, ModelRateLimitConfig>,
  resourceEstimationsPerJob?: ResourceEstimationsPerJob
): number => {
  const avgTokensPerJob = calculateAverageTokensPerJob(resourceEstimationsPerJob);
  let totalCapacity = ZERO;

  for (const modelConfig of Object.values(models)) {
    const { maxConcurrentRequests, tokensPerMinute } = modelConfig;

    if (typeof maxConcurrentRequests === 'number' && maxConcurrentRequests > ZERO) {
      // Model has explicit concurrent request limit
      totalCapacity += maxConcurrentRequests;
    } else if (typeof tokensPerMinute === 'number' && tokensPerMinute > ZERO) {
      // Model has TPM limit - estimate concurrent capacity
      const estimatedCapacity = calculateTpmBasedCapacity(tokensPerMinute, avgTokensPerJob);
      totalCapacity += Math.max(ONE, estimatedCapacity);
    }
  }

  return totalCapacity > ZERO ? totalCapacity : DEFAULT_JOB_TYPE_CAPACITY;
};
