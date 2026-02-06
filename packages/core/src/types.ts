/**
 * Type definitions for the LLM Rate Limiter.
 *
 * Resource estimates (tokens, requests, memory) are defined at the job type level
 * via resourcesPerJob in the multi-model limiter configuration.
 */

// =============================================================================
// Logging Types
// =============================================================================

/** Logging callback type */
export type LogFn = (message: string, data?: Record<string, unknown>) => void;

// =============================================================================
// Overage Tracking Types
// =============================================================================

/**
 * Type of resource that experienced an overage.
 */
export type OverageResourceType = 'tokens' | 'requests';

/**
 * Event emitted when actual usage exceeds estimated usage.
 * Useful for tracking estimation accuracy and tuning estimates over time.
 */
export interface OverageEvent {
  /** Type of resource that exceeded estimate */
  resourceType: OverageResourceType;
  /** The estimated value that was pre-reserved */
  estimated: number;
  /** The actual value recorded after job completion */
  actual: number;
  /** The overage amount (actual - estimated) */
  overage: number;
  /** Timestamp when the overage was recorded */
  timestamp: number;
}

/** Callback for handling overage events */
export type OverageFn = (event: OverageEvent) => void;

// =============================================================================
// Job Result Types
// =============================================================================

/**
 * Token usage returned by LLM job.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cached: number;
}

/**
 * Result type for internal LLM jobs - must include usage and requestCount.
 */
export interface InternalJobResult {
  /** Actual number of LLM API calls made by this job */
  requestCount: number;

  /**
   * Total token usage across ALL requests in this job.
   * This is the TOTAL sum - NOT per-request, NOT multiplied by requestCount.
   * For example, if a job makes 3 API calls using 100, 150, and 200 tokens,
   * the usage should reflect the sum: { input: X, output: Y, cached: Z } totaling 450.
   */
  usage: TokenUsage;

  [key: string]: unknown;
}

// =============================================================================
// Memory Configuration
// =============================================================================

/**
 * Memory limit configuration.
 * Controls how much system memory the rate limiter can use.
 */
export interface MemoryLimitConfig {
  /** Ratio of free memory to use, 0-1 (default: 0.8) */
  freeMemoryRatio?: number;
  /** How often to recalculate capacity in ms (default: 1000) */
  recalculationIntervalMs?: number;
}

// =============================================================================
// Resources Per Event
// =============================================================================

/**
 * Base resources interface with all fields optional.
 * Note: estimatedUsedMemoryKB is defined at job type level only (JobTypeResourceConfig).
 */
export interface BaseResourcesPerEvent {
  /** Estimated number of LLM API requests this job will make */
  estimatedNumberOfRequests?: number;
  /** Estimated total tokens this job will use across all requests */
  estimatedUsedTokens?: number;
}

// =============================================================================
// Base Configuration
// =============================================================================

/**
 * Base configuration for the internal rate limiter (without resourcesPerEvent).
 */
export interface InternalLimiterConfigBase {
  /** Memory-based limits configuration (optional) */
  memory?: MemoryLimitConfig;
  /** Maximum requests per minute (optional) */
  requestsPerMinute?: number;
  /** Maximum requests per day (optional) */
  requestsPerDay?: number;
  /** Maximum tokens per minute (optional) */
  tokensPerMinute?: number;
  /** Maximum tokens per day (optional) */
  tokensPerDay?: number;
  /** Maximum concurrent requests (optional) */
  maxConcurrentRequests?: number;
  /** Minimum slot count per job type - always have at least N slots (default: 0) */
  minCapacity?: number;
  /** Maximum slot count per job type - never exceed N slots (optional) */
  maxCapacity?: number;
  /** Label for logging (default: 'LLMRateLimiter') */
  label?: string;
  /** Optional logging callback */
  onLog?: LogFn;
  /**
   * Optional callback for overage events (when actual > estimated).
   * Useful for tracking estimation accuracy and tuning estimates over time.
   */
  onOverage?: OverageFn;
  /** Estimated number of requests per job (for pre-reservation) */
  estimatedNumberOfRequests?: number;
  /** Estimated tokens per job (for pre-reservation) */
  estimatedUsedTokens?: number;
  /** Estimated memory per job in KB (for pre-reservation) */
  estimatedUsedMemoryKB?: number;
}

// =============================================================================
// Configuration Type
// =============================================================================

/**
 * Configuration for the internal rate limiter.
 * Resource estimates (tokens, requests, memory) are at job type level (resourcesPerJob).
 */
export type InternalLimiterConfig = InternalLimiterConfigBase;

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Statistics returned by getStats() for internal limiter.
 */
export interface InternalLimiterStats {
  memory?: {
    activeKB: number;
    maxCapacityKB: number;
    availableKB: number;
    systemAvailableKB: number;
  };
  concurrency?: {
    active: number;
    limit: number;
    available: number;
    waiting: number;
  };
  requestsPerMinute?: {
    current: number;
    limit: number;
    remaining: number;
    resetsInMs: number;
  };
  requestsPerDay?: {
    current: number;
    limit: number;
    remaining: number;
    resetsInMs: number;
  };
  tokensPerMinute?: {
    current: number;
    limit: number;
    remaining: number;
    resetsInMs: number;
  };
  tokensPerDay?: {
    current: number;
    limit: number;
    remaining: number;
    resetsInMs: number;
  };
}

// =============================================================================
// Window Tracking Types (for time-aware capacity refunds)
// =============================================================================

/**
 * Window start timestamps captured at reservation time.
 * Used to determine if a job finishes within the same time window it started.
 * Each limit type (RPM, RPD, TPM, TPD) has its own window boundary.
 */
export interface JobWindowStarts {
  /** RPM window start (ms since epoch) - resets every minute */
  rpmWindowStart?: number;
  /** RPD window start (ms since epoch) - resets every day */
  rpdWindowStart?: number;
  /** TPM window start (ms since epoch) - resets every minute */
  tpmWindowStart?: number;
  /** TPD window start (ms since epoch) - resets every day */
  tpdWindowStart?: number;
}

/**
 * Context returned when capacity is reserved.
 * Must be passed back at release time for window-aware refunds.
 * Refunds only happen if the job completes within the same time window.
 */
export interface ReservationContext {
  /** Window starts at the time capacity was reserved */
  windowStarts: JobWindowStarts;
}

// =============================================================================
// Instance Type
// =============================================================================

/** Options for updating rate limits dynamically */
export interface RateLimitUpdate {
  /** New tokens per minute limit */
  tokensPerMinute?: number;
  /** New requests per minute limit */
  requestsPerMinute?: number;
  /** New tokens per day limit */
  tokensPerDay?: number;
  /** New requests per day limit */
  requestsPerDay?: number;
}

/**
 * Internal rate limiter instance returned by internal createLLMRateLimiter().
 */
export interface InternalLimiterInstance {
  /** Queue a job - job must return object with usage and requestCount properties */
  queueJob: <T extends InternalJobResult>(job: () => Promise<T> | T) => Promise<T>;
  /**
   * Queue a job with pre-reserved capacity (skips capacity wait).
   * Use this after calling tryReserve() to avoid double-reservation.
   * @param job The job function to execute
   * @param context The reservation context from tryReserve() for window-aware refunds
   */
  queueJobWithReservedCapacity: <T extends InternalJobResult>(
    job: () => Promise<T> | T,
    context: ReservationContext
  ) => Promise<T>;
  /** Stop all intervals (for cleanup) */
  stop: () => void;
  /** Check if all limits have capacity (non-blocking) */
  hasCapacity: () => boolean;
  /**
   * Atomically check and reserve capacity.
   * Returns ReservationContext if capacity was reserved, null if no capacity.
   * The context contains window starts for time-aware refunds at release.
   */
  tryReserve: () => ReservationContext | null;
  /**
   * Release previously reserved capacity (when job fails before execution).
   * Respects time window boundaries - only refunds if still in same window.
   * @param context The reservation context from tryReserve()
   */
  releaseReservation: (context: ReservationContext) => void;
  /**
   * Wait for capacity using a FIFO queue with timeout.
   * Jobs are served in order when capacity becomes available.
   * @param maxWaitMS Maximum time to wait (0 = fail fast, no waiting)
   * @returns Promise resolving to ReservationContext if reserved, null if timed out
   */
  waitForCapacityWithTimeout: (maxWaitMS: number) => Promise<ReservationContext | null>;
  /** Get current statistics */
  getStats: () => InternalLimiterStats;
  /** Update rate limits dynamically (for distributed coordination) */
  setRateLimits: (update: RateLimitUpdate) => void;
  /** Notify wait queue that external capacity changed (e.g., JTM per-model slot freed) */
  notifyExternalCapacityChange: () => void;
  /**
   * Wait for capacity using a custom reserve function.
   * Allows composing multiple capacity checks (e.g., model + JTM per-model) into one atomic reserve.
   * @param tryReserve Custom function that checks and reserves capacity atomically
   * @param maxWaitMS Maximum time to wait (0 = fail fast)
   * @returns Promise resolving to ReservationContext if reserved, null if timed out
   */
  waitForCapacityWithCustomReserve: (
    tryReserve: () => ReservationContext | null,
    maxWaitMS: number
  ) => Promise<ReservationContext | null>;
}
