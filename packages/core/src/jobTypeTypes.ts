/**
 * Type definitions for Job Type-based capacity allocation.
 *
 * Job types allow different kinds of jobs (e.g., "summarize-pdf" vs "create-recipe")
 * to have independent resource estimates and capacity ratios, while sharing
 * the same underlying model resources.
 */
import type { BaseResourcesPerEvent } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Default high load threshold (70%) */
const DEFAULT_HIGH_LOAD_THRESHOLD = 0.7;
/** Default low load threshold (30%) */
const DEFAULT_LOW_LOAD_THRESHOLD = 0.3;
/** Default maximum adjustment per cycle (20%) */
const DEFAULT_MAX_ADJUSTMENT = 0.2;
/** Default minimum ratio (1%) */
const DEFAULT_MIN_RATIO = 0.01;
/** Default adjustment interval in milliseconds (5 seconds) */
const DEFAULT_ADJUSTMENT_INTERVAL_MS = 5000;
/** Default number of releases between adjustments */
const DEFAULT_RELEASES_PER_ADJUSTMENT = 10;
/** Default minimum job type capacity (slots per job type) */
const DEFAULT_MIN_JOB_TYPE_CAPACITY = 1;
/** Default idle decay rate (30% per cycle toward initial ratios) */
const DEFAULT_IDLE_DECAY_RATE = 0.3;

// =============================================================================
// Job Type Configuration Types
// =============================================================================

/**
 * Ratio configuration for a job type's capacity allocation.
 */
export interface JobTypeRatioConfig {
  /**
   * Initial ratio of total capacity allocated to this job type (0-1).
   * All initialValue values across job types must sum to 1.
   * If not specified, the remaining capacity is distributed evenly
   * among job types without an initialValue.
   */
  initialValue?: number;

  /**
   * Whether this job type's ratio can be adjusted dynamically based on load.
   * When true (default), the system can transfer capacity from underutilized
   * job types to overutilized ones.
   * When false, this job type's ratio remains fixed at initialValue.
   * @default true
   */
  flexible?: boolean;
}

/**
 * Max wait time configuration per model.
 * Keys must be valid model IDs from the models config.
 * @typeParam ModelIds - Union of valid model ID strings
 */
export type MaxWaitMSConfig<ModelIds extends string = string> = Partial<Record<ModelIds, number>>;

/**
 * Resource configuration for a specific job type.
 * Extends base resources with ratio configuration and memory estimation.
 * @typeParam ModelIds - Union of valid model ID strings for maxWaitMS type safety
 */
export interface JobTypeResourceConfig<ModelIds extends string = string> extends BaseResourcesPerEvent {
  /**
   * Estimated memory usage in KB for this job type.
   * Required when using memory-based limiting.
   */
  estimatedUsedMemoryKB?: number;

  /**
   * Optional ratio configuration for capacity allocation.
   * If not provided, capacity is distributed evenly among all job types.
   */
  ratio?: JobTypeRatioConfig;

  /**
   * Maximum time (in milliseconds) to wait for capacity per model.
   *
   * - If not specified: Uses dynamic default (time to next minute + 5 seconds, max 65s)
   * - If 0: Fail fast - immediately delegate to next model or reject
   * - If > 0: Wait up to that many milliseconds before delegating/rejecting
   *
   * @example
   * ```typescript
   * maxWaitMS: {
   *   'gpt-5.2': 60000,    // Wait up to 60s (TPM resets predictably)
   *   'gpt-oss-20b': 5000, // Wait only 5s (concurrent limit is unpredictable)
   * }
   * ```
   */
  maxWaitMS?: MaxWaitMSConfig<ModelIds>;
}

/**
 * Map of job type ID to its resource configuration.
 * The keys become the type-safe job type identifiers.
 *
 * @typeParam K - Union of job type ID strings
 * @typeParam M - Union of model ID strings (for maxWaitMS type safety)
 *
 * @example
 * ```typescript
 * const resourceEstimationsPerJob: ResourceEstimationsPerJob = {
 *   'summarize-pdf': { estimatedUsedTokens: 20000, ratio: { initialValue: 0.7 } },
 *   'create-recipe': { estimatedUsedTokens: 500 },
 * };
 * ```
 */
export type ResourceEstimationsPerJob<K extends string = string, M extends string = string> = Record<
  K,
  JobTypeResourceConfig<M>
>;

/**
 * Extract job type IDs from ResourceEstimationsPerJob as a string literal union.
 * Enables compile-time type safety for jobType parameter.
 *
 * @example
 * ```typescript
 * type MyJobTypes = JobTypeIds<typeof myResourceEstimationsPerJob>;
 * // MyJobTypes = 'summarize-pdf' | 'create-recipe'
 * ```
 */
export type JobTypeIds<T extends ResourceEstimationsPerJob> = keyof T & string;

// =============================================================================
// Job Type Runtime State
// =============================================================================

/**
 * Estimated resources stored in job type state.
 * Includes memory
 */
export interface JobTypeResources extends BaseResourcesPerEvent {
  /** Estimated memory usage in KB for this job type */
  estimatedUsedMemoryKB?: number;
}

/**
 * Runtime state for a single job type.
 * Tracks current allocation and usage.
 */
export interface JobTypeState {
  /** Current ratio (may differ from initial due to dynamic adjustment) */
  currentRatio: number;

  /** Initial ratio at startup (from config or calculated from even distribution) */
  initialRatio: number;

  /** Whether ratio can be adjusted dynamically */
  flexible: boolean;

  /** Number of jobs currently in-flight for this type */
  inFlight: number;

  /** Slots currently allocated to this job type based on currentRatio */
  allocatedSlots: number;

  /** Estimated resources for this job type */
  resources: JobTypeResources;
}

/**
 * Per-model-per-jobType allocation and effective inFlight info.
 * For rate-based models, inFlight reflects the window counter (not concurrent count).
 */
export interface ModelJobTypeInfo {
  /** Allocated slots for this (model, jobType) pair */
  allocated: number;
  /** Effective in-flight: window counter for rate-based, concurrent count for concurrency-based (resets at window boundary) */
  inFlight: number;
}

/**
 * Stats for job types returned by getStats().
 */
export interface JobTypeStats {
  /** Stats per job type, keyed by job type ID */
  jobTypes: Record<string, JobTypeState>;

  /** Total slots available across all job types */
  totalSlots: number;

  /** Timestamp of last ratio adjustment (ms since epoch) */
  lastAdjustmentTime: number | null;

  /** Per-model per-jobType breakdown (present in distributed mode with pools) */
  modelJobTypes?: Record<string, Record<string, ModelJobTypeInfo>>;
}

// =============================================================================
// Dynamic Adjustment Configuration
// =============================================================================

/**
 * Configuration for dynamic ratio adjustment algorithm.
 */
export interface RatioAdjustmentConfig {
  /**
   * Load threshold above which a job type is considered "high load" and needs more capacity.
   * @default 0.7 (70%)
   */
  highLoadThreshold?: number;

  /**
   * Load threshold below which a job type is considered "low load" and can donate capacity.
   * @default 0.3 (30%)
   */
  lowLoadThreshold?: number;

  /**
   * Maximum ratio change per adjustment cycle.
   * Prevents drastic reallocation swings.
   * @default 0.2 (20%)
   */
  maxAdjustment?: number;

  /**
   * Minimum ratio any job type can have.
   * Ensures all job types maintain some capacity.
   * @default 0.01 (1%)
   */
  minRatio?: number;

  /**
   * Interval between automatic ratio adjustments in milliseconds.
   * Set to 0 to disable periodic adjustment (only adjust on release).
   * @default 5000 (5 seconds)
   */
  adjustmentIntervalMs?: number;

  /**
   * Number of job releases between adjustment calculations.
   * Set to 0 to disable release-triggered adjustment.
   * @default 10
   */
  releasesPerAdjustment?: number;

  /**
   * Minimum number of slots per job type.
   * Ensures every job type has at least this many slots to prevent starvation.
   * Set to 0 to allow job types to have no slots when ratios are very low.
   * @default 1
   */
  minJobTypeCapacity?: number;

  /**
   * Rate at which idle ratios decay toward initial values (0-1).
   * When all job types have zero load, each flexible ratio moves toward
   * its initialRatio by this fraction of the distance per adjustment cycle.
   * Set to 0 to disable idle decay.
   * @default 0.3
   */
  idleDecayRate?: number;
}

/**
 * Default values for ratio adjustment configuration.
 */
export const DEFAULT_RATIO_ADJUSTMENT_CONFIG: Required<RatioAdjustmentConfig> = {
  highLoadThreshold: DEFAULT_HIGH_LOAD_THRESHOLD,
  lowLoadThreshold: DEFAULT_LOW_LOAD_THRESHOLD,
  maxAdjustment: DEFAULT_MAX_ADJUSTMENT,
  minRatio: DEFAULT_MIN_RATIO,
  adjustmentIntervalMs: DEFAULT_ADJUSTMENT_INTERVAL_MS,
  releasesPerAdjustment: DEFAULT_RELEASES_PER_ADJUSTMENT,
  minJobTypeCapacity: DEFAULT_MIN_JOB_TYPE_CAPACITY,
  idleDecayRate: DEFAULT_IDLE_DECAY_RATE,
};

// =============================================================================
// Load Metrics for Adjustment
// =============================================================================

/**
 * Load metrics for a single job type, used in ratio adjustment calculations.
 */
export interface JobTypeLoadMetrics {
  /** Job type ID */
  jobTypeId: string;

  /** Current load percentage ((inFlight + queued) / allocatedSlots), 0 if no slots */
  loadPercentage: number;

  /** Whether this job type is flexible */
  flexible: boolean;

  /** Current ratio */
  currentRatio: number;
}
