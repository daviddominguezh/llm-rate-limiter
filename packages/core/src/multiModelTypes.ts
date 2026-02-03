/**
 * Type definitions for the Multi-Model LLM Rate Limiter with compile-time type safety.
 *
 * Key features:
 * 1. Per-model independent rate limits (RPM, RPD, TPM, TPD, concurrency)
 * 2. Automatic fallback to next available model when one is exhausted
 * 3. User-defined escalation order for model usage
 * 4. Compile-time type safety:
 *    - escalationOrder array can only contain model IDs that have limits defined
 *    - escalationOrder is optional for single model, required for multiple models
 */
import type { DistributedBackendFactory } from './backendFactoryTypes.js';
import type { JobTypeStats, RatioAdjustmentConfig, ResourceEstimationsPerJob } from './jobTypeTypes.js';
import type { InternalJobResult, InternalLimiterStats, LogFn, MemoryLimitConfig } from './types.js';

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
  /** Minimum capacity floor for this model (default: 0) */
  minCapacity?: number;
  /** Maximum capacity ceiling for this model (optional) */
  maxCapacity?: number;
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
export type HasMultipleModels<T extends ModelsConfig> = IsSingleModel<T> extends true ? false : true;

// =============================================================================
// Base Multi-Model Configuration
// =============================================================================

/**
 * Base configuration for rate limiter (without order).
 */
export interface LLMRateLimiterConfigBase<
  T extends ModelsConfig,
  J extends ResourceEstimationsPerJob = ResourceEstimationsPerJob,
> {
  /** Map of model ID to its rate limit configuration */
  models: T;
  /** Memory-based limits configuration (shared across all models) */
  memory?: MemoryLimitConfig;
  /** Optional logging callback */
  onLog?: LogFn;
  /** Callback triggered when available slots change */
  onAvailableSlotsChange?: OnAvailableSlotsChange;
  /**
   * Backend for distributed rate limiting.
   * - BackendConfig: Direct backend with registration and fair distribution
   * - DistributedBackendFactory: Factory that receives rate limiter config (no duplication)
   */
  backend?: BackendConfig | DistributedBackendFactory;
  /**
   * Job type configurations with per-type resource estimates and capacity ratios.
   * Each job type defines resource estimates (tokens, requests, memory) and capacity allocation.
   * Ratios determine how total capacity is divided among job types.
   */
  resourceEstimationsPerJob: J;
  /**
   * Configuration for dynamic ratio adjustment algorithm.
   */
  ratioAdjustmentConfig?: RatioAdjustmentConfig;
}

// =============================================================================
// Validated Multi-Model Configuration Type
// =============================================================================

/**
 * Validated configuration that enforces escalationOrder requirements at compile time.
 *
 * - If only one model is defined, `escalationOrder` is optional
 * - If multiple models are defined, `escalationOrder` is REQUIRED
 * - The escalationOrder array can only contain model IDs that are defined in `models`
 */
export type ValidatedLLMRateLimiterConfig<
  T extends ModelsConfig,
  J extends ResourceEstimationsPerJob = ResourceEstimationsPerJob,
> = LLMRateLimiterConfigBase<T, J> &
  (HasMultipleModels<T> extends true
    ? { escalationOrder: ReadonlyArray<ModelIds<T>> }
    : { escalationOrder?: ReadonlyArray<ModelIds<T>> });

/**
 * Loose configuration type for internal use.
 * Use ValidatedLLMRateLimiterConfig<T> for strict compile-time checking.
 */
export interface LLMRateLimiterConfig {
  models: ModelsConfig;
  /** Model escalation priority order (first model is preferred, fallback to next) */
  escalationOrder?: readonly string[];
  memory?: MemoryLimitConfig;
  onLog?: LogFn;
  onAvailableSlotsChange?: OnAvailableSlotsChange;
  /** Backend for distributed rate limiting */
  backend?: BackendConfig | DistributedBackendFactory;
  /** Job type configurations with per-type resource estimates and capacity ratios (required) */
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  /** Configuration for dynamic ratio adjustment algorithm */
  ratioAdjustmentConfig?: RatioAdjustmentConfig;
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
 * Uses Omit to avoid intersection conflict with ArgsWithoutModelId's `modelId?: never`.
 */
export type JobArgs<Args extends ArgsWithoutModelId> = { modelId: string } & Omit<Args, 'modelId'>;

/**
 * Job function signature with resolve/reject callbacks for delegation support.
 *
 * @param args - Combined args with modelId injected by rate limiter
 * @param resolve - Call when job succeeds, must provide usage for this model
 * @param reject - Call when job fails, must provide usage for this model
 */
export type LLMJob<T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId> = (
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
export interface QueueJobOptions<
  T extends InternalJobResult,
  Args extends ArgsWithoutModelId = ArgsWithoutModelId,
  JobType extends string = string,
> {
  /** Unique identifier for this job (for traceability) */
  jobId: string;
  /**
   * Job type for capacity allocation (required).
   * Must match a key in resourcesPerJob configuration.
   * Determines which capacity pool the job uses.
   */
  jobType: JobType;
  /** Job function that receives args with modelId, and resolve/reject callbacks */
  job: LLMJob<T, Args>;
  /** User-defined args passed to job (modelId is injected automatically) */
  args?: Args;
  /** Called when job completes successfully on any model */
  onComplete?: (result: LLMJobResult<T>, context: JobCallbackContext) => void;
  /** Called when job fails without delegation or all models exhausted */
  onError?: (error: Error, context: JobCallbackContext) => void;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for jobs that includes which model was used.
 */
export type LLMJobResult<T extends InternalJobResult> = T & {
  /** The model ID that was used to execute this job */
  modelUsed: string;
};

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Statistics for all models in the rate limiter.
 */
export interface LLMRateLimiterStats {
  /** Stats per model, keyed by model ID */
  models: Record<string, InternalLimiterStats>;
  /** Shared memory stats (if memory is configured) */
  memory?: {
    activeKB: number;
    maxCapacityKB: number;
    availableKB: number;
    systemAvailableKB: number;
  };
  /** Job type stats (present when resourcesPerJob is configured) */
  jobTypes?: JobTypeStats;
}

// =============================================================================
// Availability Change Callback Types
// =============================================================================

/** Literal type for zero (used in RelativeAvailabilityAdjustment) */
// eslint incorrectly flags this as magic number but it's a type literal definition
type ZeroLiteral = (readonly [])['length'];

/** Current availability across all limiters */
export interface Availability {
  /** Number of jobs that can be executed (minimum across all limiters) */
  slots: number;
  /** Available tokens per minute (remaining), null if not configured */
  tokensPerMinute: number | null;
  /** Available tokens per day (remaining), null if not configured */
  tokensPerDay: number | null;
  /** Available requests per minute (remaining), null if not configured */
  requestsPerMinute: number | null;
  /** Available requests per day (remaining), null if not configured */
  requestsPerDay: number | null;
  /** Available concurrent request slots, null if not configured */
  concurrentRequests: number | null;
  /** Available memory in KB, null if not configured */
  memoryKB: number | null;
}

/** Reason for availability change (in priority order: first applicable wins) */
export type AvailabilityChangeReason =
  | 'adjustment' // Job used different resources than reserved
  | 'tokensMinute' // TPM changed (reservation, refund, or window reset)
  | 'tokensDay' // TPD changed
  | 'requestsMinute' // RPM changed
  | 'requestsDay' // RPD changed
  | 'concurrentRequests' // Concurrency changed
  | 'memory' // Memory changed
  | 'distributed'; // Distributed backend availability update

/** Relative adjustment values (actual - reserved). Only provided when reason is 'adjustment'. */
export interface RelativeAvailabilityAdjustment {
  /** Token difference (actual - reserved). Negative = fewer used than reserved */
  tokensPerMinute: number;
  /** Token difference (actual - reserved). Negative = fewer used than reserved */
  tokensPerDay: number;
  /** Request difference (actual - reserved). Negative = fewer used than reserved */
  requestsPerMinute: number;
  /** Request difference (actual - reserved). Negative = fewer used than reserved */
  requestsPerDay: number;
  /** Always 0 for adjustment (memory is not adjusted post-job) */
  memoryKB: ZeroLiteral;
  /** Always 0 for adjustment (concurrency is not adjusted post-job) */
  concurrentRequests: ZeroLiteral;
}

/** Callback triggered when available slots change */
export type OnAvailableSlotsChange = (
  availability: Availability,
  reason: AvailabilityChangeReason,
  modelId: string,
  adjustment?: RelativeAvailabilityAdjustment
) => void;

// =============================================================================
// Backend (Distributed Rate Limiting) Types
// =============================================================================

/** Estimated resources for backend acquire (memory excluded - local only) */
export interface BackendEstimatedResources {
  /** Estimated number of requests */
  requests: number;
  /** Estimated number of tokens */
  tokens: number;
}

/** Actual resources used after job completion */
export interface BackendActualResources {
  /** Actual number of requests made */
  requests: number;
  /** Actual number of tokens used (input + output) */
  tokens: number;
}

/** Allocation info for a specific instance from the distributed backend */
export interface AllocationInfo {
  /** Slots allocated to THIS instance (how many more jobs to fetch) */
  slots: number;
  /** Tokens per minute allocated to THIS instance */
  tokensPerMinute: number;
  /** Requests per minute allocated to THIS instance */
  requestsPerMinute: number;
}

/** Callback for allocation updates from distributed backend */
export type AllocationCallback = (allocation: AllocationInfo) => void;

/** Unsubscribe function returned by subscribe */
export type Unsubscribe = () => void;

/** Context passed to backend.acquire callback */
export interface BackendAcquireContext {
  /** The instance making the acquire request */
  instanceId: string;
  /** The model being acquired */
  modelId: string;
  /** Job identifier */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Estimated resources for this job */
  estimated: BackendEstimatedResources;
}

/** Context passed to backend.release callback */
export interface BackendReleaseContext {
  /** The instance making the release request */
  instanceId: string;
  /** The model being released */
  modelId: string;
  /** Job identifier */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Estimated resources that were reserved */
  estimated: BackendEstimatedResources;
  /** Actual resources used (zero if job failed before execution) */
  actual: BackendActualResources;
}

/**
 * Backend configuration for distributed rate limiting with fair distribution.
 * Provides instance registration and allocation-based slot distribution.
 */
export interface BackendConfig {
  /**
   * Register this instance with the backend.
   * Called when the rate limiter starts.
   * @returns Initial allocation for this instance
   */
  register: (instanceId: string) => Promise<AllocationInfo>;

  /**
   * Unregister this instance from the backend.
   * Called when the rate limiter stops.
   */
  unregister: (instanceId: string) => Promise<void>;

  /**
   * Called before executing a job to acquire a slot from this instance's allocation.
   * Return true to proceed, false to reject (no capacity in allocation).
   */
  acquire: (context: BackendAcquireContext) => Promise<boolean>;

  /**
   * Called after job completes to release capacity and trigger reallocation.
   */
  release: (context: BackendReleaseContext) => Promise<void>;

  /**
   * Subscribe to allocation updates for this instance.
   * Callback is called immediately with current allocation, then on each update.
   * @returns Unsubscribe function
   */
  subscribe: (instanceId: string, callback: AllocationCallback) => Unsubscribe;
}

// Re-export backend factory types from dedicated module
export type {
  BackendFactoryInitConfig,
  BackendFactoryInstance,
  DistributedBackendFactory,
} from './backendFactoryTypes.js';
export { isDistributedBackendFactory } from './backendFactoryTypes.js';

/** Availability from distributed backend (memory and concurrency are local-only) */
export interface DistributedAvailability {
  /** Number of jobs that can be executed */
  slots: number;
  /** Available tokens per minute (remaining), null if not tracked */
  tokensPerMinute?: number | null;
  /** Available tokens per day (remaining), null if not tracked */
  tokensPerDay?: number | null;
  /** Available requests per minute (remaining), null if not tracked */
  requestsPerMinute?: number | null;
  /** Available requests per day (remaining), null if not tracked */
  requestsPerDay?: number | null;
}

// =============================================================================
// Job Execution Context
// =============================================================================

/**
 * Internal context for tracking job execution state during delegation.
 */
export interface JobExecutionContext<T extends InternalJobResult, Args extends ArgsWithoutModelId> {
  jobId: string;
  /** Job type for capacity allocation (required) */
  jobType: string;
  job: QueueJobOptions<T, Args>['job'];
  args: Args | undefined;
  triedModels: Set<string>;
  usage: JobUsage;
  onComplete: ((result: LLMJobResult<T>, context: JobCallbackContext) => void) | undefined;
  onError: ((error: Error, context: JobCallbackContext) => void) | undefined;
}

// =============================================================================
// Instance Type
// =============================================================================

/**
 * Rate limiter instance returned by createLLMRateLimiter().
 *
 * @typeParam JobType - Union type of valid job type IDs (from resourcesPerJob keys)
 */
export interface LLMRateLimiterInstance<JobType extends string = string> {
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
  queueJob: <T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args, JobType>
  ) => Promise<LLMJobResult<T>>;

  /**
   * Queue a job for a specific model without fallback.
   * Will wait until the specified model has capacity.
   *
   * @param modelId - The specific model to use
   * @param job - Function that returns a job result
   * @returns Promise resolving to job result
   */
  queueJobForModel: <T extends InternalJobResult>(modelId: string, job: () => Promise<T> | T) => Promise<T>;

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
  getStats: () => LLMRateLimiterStats;

  /**
   * Get statistics for a specific model.
   *
   * @param modelId - The model to get stats for
   * @returns Stats for the specified model
   */
  getModelStats: (modelId: string) => InternalLimiterStats;

  /**
   * Start the rate limiter and register with V2 distributed backend if configured.
   * For V1 backends or no backend, this is a no-op.
   * Must be called before queueing jobs when using V2 backend.
   */
  start: () => Promise<void>;

  /**
   * Stop all intervals and unregister from V2 distributed backend if configured.
   */
  stop: () => void;

  /**
   * Get the unique instance ID for this rate limiter (for distributed coordination).
   */
  getInstanceId: () => string;

  /**
   * Push distributed availability from external backend (e.g., Redis pub/sub).
   * Emits onAvailableSlotsChange with reason 'distributed'.
   *
   * @param availability - Current availability from distributed backend
   */
  setDistributedAvailability: (availability: DistributedAvailability) => void;

  /**
   * Check if a specific job type has capacity (non-blocking).
   * Only applicable when resourcesPerJob is configured.
   *
   * @param jobType - The job type to check
   * @returns true if the job type has capacity, false otherwise
   * @returns true if resourcesPerJob is not configured (backward compatible)
   */
  hasCapacityForJobType: (jobType: JobType) => boolean;

  /**
   * Get job type statistics.
   * Only applicable when resourcesPerJob is configured.
   *
   * @returns Job type stats, or undefined if resourcesPerJob is not configured
   */
  getJobTypeStats: () => JobTypeStats | undefined;
}
