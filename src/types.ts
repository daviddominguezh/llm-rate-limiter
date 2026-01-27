/**
 * Type definitions for the LLM Rate Limiter with strict compile-time type safety.
 *
 * The configuration enforces at compile time:
 * 1. If `requestsPerMinute` OR `requestsPerDay` is set -> `resourcesPerEvent.estimatedNumberOfRequests` is REQUIRED
 * 2. If `tokensPerMinute` OR `tokensPerDay` is set -> `resourcesPerEvent.estimatedUsedTokens` is REQUIRED
 * 3. If `memory` is set -> `resourcesPerEvent.estimatedUsedMemoryKB` is REQUIRED
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
 * Note: minCapacity and maxCapacity are now at the main config level.
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
 */
export interface BaseResourcesPerEvent {
  /** Estimated number of LLM API requests this job will make (required for RPM/RPD limits) */
  estimatedNumberOfRequests?: number;
  /** Estimated total tokens this job will use across all requests (required for TPM/TPD limits) */
  estimatedUsedTokens?: number;
  /** Estimated memory usage in KB for this job (required for memory limits) */
  estimatedUsedMemoryKB?: number;
}

/** Required field for request-based limits */
interface RequestResources {
  estimatedNumberOfRequests: number;
}

/** Required field for token-based limits */
interface TokenResources {
  estimatedUsedTokens: number;
}

/** Required field for memory-based limits */
interface MemoryResources {
  estimatedUsedMemoryKB: number;
}

// =============================================================================
// Conditional Type Helpers
// =============================================================================

/**
 * Infer required resourcesPerEvent fields based on configured limits.
 */
export type InferResourcesPerEvent<T> = (T extends
  | { requestsPerMinute: number }
  | { requestsPerDay: number }
  ? RequestResources
  : Partial<RequestResources>) &
  (T extends { tokensPerMinute: number } | { tokensPerDay: number }
    ? TokenResources
    : Partial<TokenResources>) &
  (T extends { memory: MemoryLimitConfig } ? MemoryResources : Partial<MemoryResources>);

/**
 * Check if any limit that requires resourcesPerEvent is configured.
 */
export type HasAnyResourceLimit<T> = T extends { memory: MemoryLimitConfig }
  ? true
  : T extends { requestsPerMinute: number }
    ? true
    : T extends { requestsPerDay: number }
      ? true
      : T extends { tokensPerMinute: number }
        ? true
        : T extends { tokensPerDay: number }
          ? true
          : false;

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
}

// =============================================================================
// Validated Configuration Type
// =============================================================================

/**
 * Validated configuration type that enforces resourcesPerEvent requirements at compile time.
 *
 * - If any limit (memory, RPM, RPD, TPM, TPD) is set, resourcesPerEvent is required
 * - The specific fields in resourcesPerEvent depend on which limits are configured
 */
export type InternalValidatedConfig<T extends InternalLimiterConfigBase> = T &
  (HasAnyResourceLimit<T> extends true
    ? { resourcesPerEvent: InferResourcesPerEvent<T> }
    : { resourcesPerEvent?: BaseResourcesPerEvent });

/**
 * Configuration for the internal rate limiter.
 * Use InternalValidatedConfig<T> for strict compile-time checking.
 */
export type InternalLimiterConfig = InternalLimiterConfigBase & {
  resourcesPerEvent?: BaseResourcesPerEvent;
};

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
}
