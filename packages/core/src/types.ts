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
 * Note: minCapacity and maxCapacity are now at the model level (ModelRateLimitConfig).
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
  /** Minimum capacity floor - always run at least N jobs ignoring limits (default: 0) */
  minCapacity?: number;
  /** Maximum capacity ceiling for the whole queue (optional) */
  maxCapacity?: number;
  /** Label for logging (default: 'LLMRateLimiter') */
  label?: string;
  /** Optional logging callback */
  onLog?: LogFn;
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
// Instance Type
// =============================================================================

/** Options for updating rate limits dynamically */
export interface RateLimitUpdate {
  /** New tokens per minute limit */
  tokensPerMinute?: number;
  /** New requests per minute limit */
  requestsPerMinute?: number;
}

/**
 * Internal rate limiter instance returned by internal createLLMRateLimiter().
 */
export interface InternalLimiterInstance {
  /** Queue a job - job must return object with usage and requestCount properties */
  queueJob: <T extends InternalJobResult>(job: () => Promise<T> | T) => Promise<T>;
  /** Stop all intervals (for cleanup) */
  stop: () => void;
  /** Check if all limits have capacity (non-blocking) */
  hasCapacity: () => boolean;
  /** Get current statistics */
  getStats: () => InternalLimiterStats;
  /** Update rate limits dynamically (for distributed coordination) */
  setRateLimits: (update: RateLimitUpdate) => void;
}
