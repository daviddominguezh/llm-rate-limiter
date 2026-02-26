/**
 * Type definitions for distributed backend rate limiting.
 *
 * These types support coordination across multiple instances for fair
 * distribution of rate limit capacity and resource tracking.
 */

// =============================================================================
// Backend Resource Types
// =============================================================================

/** Estimated resources for backend acquire (memory excluded - local only) */
export interface BackendEstimatedResources {
  requests: number;
  tokens: number;
}

/** Actual resources used after job completion */
export interface BackendActualResources {
  requests: number;
  tokens: number;
}

// =============================================================================
// Pool Allocation Types
// =============================================================================

/** Per-model pool allocation (pool-based slot allocation) */
export interface ModelPoolAllocation {
  /** Total slots available for this model in this instance's pool (used by JTM for ratio calculation) */
  totalSlots: number;
  /** How many more slots this instance can acquire (in-flight-aware). Falls back to totalSlots if absent. */
  acquirableSlots?: number;
  /** Per-instance tokens per minute limit for this model */
  tokensPerMinute: number;
  /** Per-instance requests per minute limit for this model */
  requestsPerMinute: number;
  /** Per-instance tokens per day limit for this model */
  tokensPerDay: number;
  /** Per-instance requests per day limit for this model */
  requestsPerDay: number;
  /** Per-instance max concurrent requests (0 if not configured) */
  maxConcurrentRequests?: number;
}

/** Pool allocation by model ID */
export type Pools = Record<string, ModelPoolAllocation>;

// =============================================================================
// Dynamic Limits Types
// =============================================================================

/**
 * Dynamic limit configuration for a single model.
 * Contains remaining capacity based on global actual usage.
 */
export interface DynamicLimitConfig {
  /** Remaining tokens per minute for this instance */
  tokensPerMinute?: number;
  /** Remaining requests per minute for this instance */
  requestsPerMinute?: number;
  /** Remaining tokens per day for this instance */
  tokensPerDay?: number;
  /** Remaining requests per day for this instance */
  requestsPerDay?: number;
}

/**
 * Dynamic limits per model based on remaining global capacity after actual usage.
 * Calculated as: (globalLimit - globalActualUsage) / instanceCount
 */
export type DynamicLimits = Record<string, DynamicLimitConfig>;

// =============================================================================
// Allocation Types
// =============================================================================

/** Allocation info for a specific instance from the distributed backend */
export interface AllocationInfo {
  /** Number of active instances sharing the rate limits */
  instanceCount: number;
  /**
   * Pool allocation per model (pool-based slot allocation).
   * Redis tracks capacity per-model only; local instances distribute across job types.
   * Structure: { [modelId]: { totalSlots, tokensPerMinute, requestsPerMinute, ... } }
   */
  pools: Pools;
  /**
   * Dynamic limits per model based on remaining global capacity after actual usage.
   * When present, instances should use these limits instead of dividing config by instanceCount.
   */
  dynamicLimits?: DynamicLimits;
}

/** Callback for allocation updates from distributed backend */
export type AllocationCallback = (allocation: AllocationInfo) => void;
/** Unsubscribe function returned by subscribe */
export type Unsubscribe = () => void;

// =============================================================================
// Backend Context Types
// =============================================================================

/** Context passed to backend.acquire callback */
export interface BackendAcquireContext {
  /** The instance making the acquire request */
  instanceId: string;
  /** The model being acquired */
  modelId: string;
  /** Job identifier */
  jobId: string;
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
  /** Estimated resources that were reserved */
  estimated: BackendEstimatedResources;
  /** Actual resources used (zero if job failed before execution) */
  actual: BackendActualResources;
  /** Window start timestamps for distributed usage tracking */
  windowStarts?: {
    /** TPM window start (ms since epoch) */
    tpmWindowStart?: number;
    /** RPM window start (ms since epoch) */
    rpmWindowStart?: number;
    /** TPD window start (ms since epoch) */
    tpdWindowStart?: number;
    /** RPD window start (ms since epoch) */
    rpdWindowStart?: number;
  };
}

// =============================================================================
// Backend Config Interface
// =============================================================================

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
