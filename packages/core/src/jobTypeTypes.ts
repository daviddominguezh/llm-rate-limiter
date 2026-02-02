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

/** Default high load threshold (80%) */
const DEFAULT_HIGH_LOAD_THRESHOLD = 0.8;
/** Default low load threshold (30%) */
const DEFAULT_LOW_LOAD_THRESHOLD = 0.3;
/** Default maximum adjustment per cycle (10%) */
const DEFAULT_MAX_ADJUSTMENT = 0.1;
/** Default minimum ratio (5%) */
const DEFAULT_MIN_RATIO = 0.05;
/** Default adjustment interval in milliseconds (5 seconds) */
const DEFAULT_ADJUSTMENT_INTERVAL_MS = 5000;
/** Default number of releases between adjustments */
const DEFAULT_RELEASES_PER_ADJUSTMENT = 10;

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
 * Resource configuration for a specific job type.
 * Extends base resources with ratio configuration.
 */
export interface JobTypeResourceConfig extends BaseResourcesPerEvent {
  /**
   * Optional ratio configuration for capacity allocation.
   * If not provided, capacity is distributed evenly among all job types.
   */
  ratio?: JobTypeRatioConfig;
}

/**
 * Map of job type ID to its resource configuration.
 * The keys become the type-safe job type identifiers.
 *
 * @example
 * ```typescript
 * const resourcesPerJob: ResourcesPerJob = {
 *   'summarize-pdf': { estimatedUsedTokens: 20000, ratio: { initialValue: 0.7 } },
 *   'create-recipe': { estimatedUsedTokens: 500 },
 * };
 * ```
 */
export type ResourcesPerJob<K extends string = string> = Record<K, JobTypeResourceConfig>;

/**
 * Extract job type IDs from ResourcesPerJob as a string literal union.
 * Enables compile-time type safety for jobType parameter.
 *
 * @example
 * ```typescript
 * type MyJobTypes = JobTypeIds<typeof myResourcesPerJob>;
 * // MyJobTypes = 'summarize-pdf' | 'create-recipe'
 * ```
 */
export type JobTypeIds<T extends ResourcesPerJob> = keyof T & string;

// =============================================================================
// Job Type Runtime State
// =============================================================================

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
  resources: BaseResourcesPerEvent;
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
   * @default 0.8 (80%)
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
   * @default 0.1 (10%)
   */
  maxAdjustment?: number;

  /**
   * Minimum ratio any job type can have.
   * Ensures all job types maintain some capacity.
   * @default 0.05 (5%)
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

  /** Current load percentage (inFlight / allocatedSlots), 0 if no slots */
  loadPercentage: number;

  /** Whether this job type is flexible */
  flexible: boolean;

  /** Current ratio */
  currentRatio: number;
}
