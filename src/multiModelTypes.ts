/**
 * Type definitions for the Multi-Model LLM Rate Limiter with compile-time type safety.
 *
 * Key features:
 * 1. Per-model independent rate limits (RPM, RPD, TPM, TPD, concurrency)
 * 2. Automatic fallback to next available model when one is exhausted
 * 3. User-defined priority order for model usage
 * 4. Compile-time type safety:
 *    - Order array can only contain model IDs that have limits defined
 *    - Order is optional for single model, required for multiple models
 */

import type {
  BaseResourcesPerEvent,
  LLMJobResult,
  LLMRateLimiterStats,
  LogFn,
  MemoryLimitConfig,
} from './types.js';

// =============================================================================
// Model Configuration Types
// =============================================================================

/**
 * Pricing configuration for a model (all prices in USD per million tokens).
 */
export interface ModelPricing {
  /** Price per million input tokens (USD) */
  input: number;
  /** Price per million cached tokens (USD) */
  cached: number;
  /** Price per million output tokens (USD) */
  output: number;
}

/**
 * Rate limit configuration for a single model.
 * All limits are optional - only defined limits are enforced.
 */
export interface ModelRateLimitConfig {
  /** Maximum requests per minute for this model (optional) */
  requestsPerMinute?: number;
  /** Maximum requests per day for this model (optional) */
  requestsPerDay?: number;
  /** Maximum tokens per minute for this model (optional) */
  tokensPerMinute?: number;
  /** Maximum tokens per day for this model (optional) */
  tokensPerDay?: number;
  /** Maximum concurrent requests for this model (optional) */
  maxConcurrentRequests?: number;
  /** Estimated resources per event for this model */
  resourcesPerEvent?: BaseResourcesPerEvent;
  /** Pricing for cost calculation (USD per million tokens) */
  pricing: ModelPricing;
}

/**
 * Map of model ID to its rate limit configuration.
 */
export type ModelsConfig = Record<string, ModelRateLimitConfig>;

// =============================================================================
// Conditional Type Helpers for Order Requirement
// =============================================================================

/**
 * Extract model IDs from a models config as a string literal union.
 */
export type ModelIds<T extends ModelsConfig> = keyof T & string;

/**
 * Check if a models config has exactly one model.
 * Uses tuple length check to determine single vs multiple keys.
 */
type IsSingleModel<T extends ModelsConfig> = keyof T extends infer K
  ? [K] extends [string]
    ? Exclude<keyof T, K> extends never
      ? true
      : false
    : false
  : false;

/**
 * Check if a models config has more than one model.
 */
export type HasMultipleModels<T extends ModelsConfig> = IsSingleModel<T> extends true
  ? false
  : true;

// =============================================================================
// Base Multi-Model Configuration
// =============================================================================

/**
 * Base configuration for multi-model rate limiter (without order).
 */
export interface MultiModelRateLimiterConfigBase<T extends ModelsConfig> {
  /** Map of model ID to its rate limit configuration */
  models: T;
  /** Memory-based limits configuration (shared across all models) */
  memory?: MemoryLimitConfig;
  /** Minimum capacity floor for memory (default: 0) */
  minCapacity?: number;
  /** Maximum capacity ceiling for memory (optional) */
  maxCapacity?: number;
  /** Label for logging (default: 'MultiModelRateLimiter') */
  label?: string;
  /** Optional logging callback */
  onLog?: LogFn;
}

// =============================================================================
// Validated Multi-Model Configuration Type
// =============================================================================

/**
 * Validated multi-model configuration that enforces order requirements at compile time.
 *
 * - If only one model is defined, `order` is optional
 * - If multiple models are defined, `order` is REQUIRED
 * - The `order` array can only contain model IDs that are defined in `models`
 */
export type ValidatedMultiModelConfig<T extends ModelsConfig> =
  MultiModelRateLimiterConfigBase<T> &
    (HasMultipleModels<T> extends true
      ? { order: ReadonlyArray<ModelIds<T>> }
      : { order?: ReadonlyArray<ModelIds<T>> });

/**
 * Loose multi-model configuration type for internal use.
 * Use ValidatedMultiModelConfig<T> for strict compile-time checking.
 */
export interface MultiModelRateLimiterConfig {
  models: ModelsConfig;
  order?: readonly string[];
  memory?: MemoryLimitConfig;
  minCapacity?: number;
  maxCapacity?: number;
  label?: string;
  onLog?: LogFn;
}

// =============================================================================
// Job Delegation Types
// =============================================================================

/**
 * Usage entry for a single model attempt (provided by the job to resolve/reject).
 * Each model that processes the job (even if it fails) should report its token usage.
 */
export interface UsageEntry {
  /** The model that was used */
  modelId: string;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of cached tokens (from prompt caching) */
  cachedTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
}

/**
 * Usage entry with calculated cost (returned in callbacks).
 */
export interface UsageEntryWithCost extends UsageEntry {
  /** Calculated cost in USD based on model pricing */
  cost: number;
}

/**
 * Accumulated usage from all model attempts during job execution.
 * Contains one entry per model that actually processed the job, with calculated costs.
 */
export type JobUsage = UsageEntryWithCost[];

/**
 * Options for job rejection callback.
 */
export interface JobRejectOptions {
  /** If true (default), delegate to next available model. If false, fail immediately. */
  delegate?: boolean;
}

/**
 * Type that prohibits modelId in user args to prevent overwriting.
 * The rate limiter injects modelId automatically.
 */
export type ArgsWithoutModelId = Record<string, unknown> & { modelId?: never };

/**
 * Job args with modelId injected by the rate limiter.
 */
export type JobArgs<Args extends ArgsWithoutModelId> = { modelId: string } & Args;

/**
 * Job function signature with resolve/reject callbacks for delegation support.
 *
 * @param args - Combined args with modelId injected by rate limiter
 * @param resolve - Call when job succeeds, must provide usage for this model
 * @param reject - Call when job fails, must provide usage for this model
 */
export type MultiModelJob<T extends LLMJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId> = (
  args: JobArgs<Args>,
  resolve: (usage: UsageEntry) => void,
  reject: (usage: UsageEntry, opts?: JobRejectOptions) => void
) => Promise<T> | T;

/**
 * Callback context for onComplete and onError handlers.
 */
export interface JobCallbackContext {
  /** Unique identifier for this job */
  jobId: string;
  /** Total cost across all model attempts (USD) */
  totalCost: number;
  /** Accumulated usage from all model attempts with individual costs */
  usage: JobUsage;
}

/**
 * Options for queueJob with delegation support.
 */
export interface QueueJobOptions<T extends LLMJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId> {
  /** Unique identifier for this job (for traceability) */
  jobId: string;
  /** Job function that receives args with modelId, and resolve/reject callbacks */
  job: MultiModelJob<T, Args>;
  /** User-defined args passed to job (modelId is injected automatically) */
  args?: Args;
  /** Called when job completes successfully on any model */
  onComplete?: (result: MultiModelJobResult<T>, context: JobCallbackContext) => void;
  /** Called when job fails without delegation or all models exhausted */
  onError?: (error: Error, context: JobCallbackContext) => void;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for multi-model jobs that includes which model was used.
 */
export type MultiModelJobResult<T extends LLMJobResult> = T & {
  /** The model ID that was used to execute this job */
  modelUsed: string;
};

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Statistics for all models in the multi-model rate limiter.
 */
export interface MultiModelRateLimiterStats {
  /** Stats per model, keyed by model ID */
  models: Record<string, LLMRateLimiterStats>;
  /** Shared memory stats (if memory is configured) */
  memory?: {
    activeKB: number;
    maxCapacityKB: number;
    availableKB: number;
    systemAvailableKB: number;
  };
}

// =============================================================================
// Instance Type
// =============================================================================

/**
 * Multi-model rate limiter instance returned by createMultiModelRateLimiter().
 */
export interface MultiModelRateLimiterInstance {
  /**
   * Queue a job with automatic model selection, delegation support, and callbacks.
   *
   * The job function receives:
   * - args: User args merged with { modelId } injected by the rate limiter
   * - resolve: Call when job succeeds
   * - reject: Call when job fails, with optional { delegate: boolean }
   *
   * @param options - Job options including job function, args, and callbacks
   * @returns Promise resolving to job result with modelUsed property
   */
  queueJob: <T extends LLMJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ) => Promise<MultiModelJobResult<T>>;

  /**
   * Queue a job for a specific model without fallback.
   * Will wait until the specified model has capacity.
   *
   * @param modelId - The specific model to use
   * @param job - Function that returns a job result
   * @returns Promise resolving to job result
   */
  queueJobForModel: <T extends LLMJobResult>(
    modelId: string,
    job: () => Promise<T> | T
  ) => Promise<T>;

  /**
   * Check if any model has capacity (non-blocking).
   *
   * @returns true if at least one model has capacity
   */
  hasCapacity: () => boolean;

  /**
   * Check if a specific model has capacity (non-blocking).
   *
   * @param modelId - The model to check
   * @returns true if the model has capacity
   */
  hasCapacityForModel: (modelId: string) => boolean;

  /**
   * Get the next available model ID based on priority order.
   *
   * @returns The model ID with capacity, or null if all exhausted
   */
  getAvailableModel: () => string | null;

  /**
   * Get statistics for all models.
   *
   * @returns Stats object with per-model stats and shared memory stats
   */
  getStats: () => MultiModelRateLimiterStats;

  /**
   * Get statistics for a specific model.
   *
   * @param modelId - The model to get stats for
   * @returns Stats for the specified model
   */
  getModelStats: (modelId: string) => LLMRateLimiterStats;

  /**
   * Stop all intervals for cleanup.
   */
  stop: () => void;
}
