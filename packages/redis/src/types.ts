/**
 * Type definitions for the Redis distributed backend.
 */
import type { BackendConfig, ModelRateLimitConfig, ResourceEstimationsPerJob } from '@llm-rate-limiter/core';
import type { Redis, RedisOptions } from 'ioredis';

// =============================================================================
// Factory Types (New Clean API)
// =============================================================================

/**
 * User-facing configuration for createRedisBackend.
 * Minimal config - no duplication with rate limiter config.
 */
export interface RedisBackendUserConfig {
  /** Redis connection URL (e.g., 'redis://localhost:6379' or 'rediss://...') */
  url: string;
  /** Key prefix for Redis keys (default: 'llm-rate-limiter:') */
  keyPrefix?: string;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Instance timeout in ms (default: 15000) - instances not seen for this long are cleaned up */
  instanceTimeoutMs?: number;
}

/**
 * Configuration passed from rate limiter to Redis backend during initialization.
 * Contains all model and job type configuration.
 */
export interface RedisBackendInitConfig {
  /** Map of model ID to its rate limit configuration */
  models: Record<string, ModelRateLimitConfig>;
  /** Job type configurations with per-type resource estimates and capacity ratios */
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
  /** Model escalation priority order */
  escalationOrder?: readonly string[];
}

/**
 * Factory returned by createRedisBackend (new clean API).
 * Rate limiter calls initialize() with its config to create the actual backend.
 */
export interface RedisBackendFactory {
  /**
   * Initialize the Redis backend with rate limiter configuration.
   * Called automatically by the rate limiter during start().
   */
  initialize: (config: RedisBackendInitConfig) => Promise<RedisBackendInstance>;

  /**
   * Check if backend has been initialized.
   */
  isInitialized: () => boolean;

  /**
   * Get the initialized backend instance.
   * Throws if not yet initialized.
   */
  getInstance: () => RedisBackendInstance;

  /**
   * Stop the backend and close all Redis connections.
   * Called automatically by the rate limiter during stop().
   */
  stop: () => Promise<void>;
}

/**
 * Redis connection options when not providing an existing client.
 */
export interface RedisConnectionOptions {
  /** Redis host (default: 'localhost') */
  host: string;
  /** Redis port (default: 6379) */
  port: number;
  /** Redis password (optional) */
  password?: string;
  /** Redis database number (default: 0) */
  db?: number;
  /** Enable TLS (optional) */
  tls?: boolean;
}

/**
 * Configuration for creating a Redis distributed backend (user-facing).
 */
export interface RedisBackendConfig {
  /** Redis connection (ioredis client or connection options) */
  redis: Redis | RedisConnectionOptions;
  /** Key prefix for Redis keys (default: 'llm-rl:') */
  keyPrefix?: string;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Instance timeout in ms (default: 15000) - instances not seen for this long are cleaned up */
  instanceTimeoutMs?: number;
}

/**
 * Per-model capacity configuration for slot calculation.
 */
export interface ModelCapacityConfig {
  /** Tokens per minute limit (null if not configured) */
  tokensPerMinute: number | null;
  /** Requests per minute limit (null if not configured) */
  requestsPerMinute: number | null;
  /** Maximum concurrent requests (null if not configured) */
  maxConcurrentRequests: number | null;
  /** Tokens per day limit (null if not configured) */
  tokensPerDay: number | null;
  /** Requests per day limit (null if not configured) */
  requestsPerDay: number | null;
}

/**
 * Internal configuration for Redis backend implementation.
 * Built by the factory from model configs - not user-facing.
 */
export interface RedisBackendInternalConfig extends RedisBackendConfig {
  /** Total capacity derived from model configs */
  totalCapacity: number;
  /** Total tokens per minute derived from model configs */
  tokensPerMinute: number;
  /** Total requests per minute derived from model configs */
  requestsPerMinute: number;
  /** Job type configuration (required for slot calculation) */
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
  /** Per-model capacity configuration for slot calculation */
  modelCapacities?: Record<string, ModelCapacityConfig>;
}

/**
 * Stats for a single instance in the Redis backend.
 */
export interface RedisInstanceStats {
  /** Instance ID */
  id: string;
  /** Number of in-flight jobs */
  inFlight: number;
  /** Current allocation (available slots) */
  allocation: number;
  /** Last heartbeat timestamp */
  lastHeartbeat: number;
}

/**
 * Overall stats for the Redis backend.
 */
export interface RedisBackendStats {
  /** Total number of registered instances */
  totalInstances: number;
  /** Total in-flight jobs across all instances */
  totalInFlight: number;
  /** Total allocated slots across all instances */
  totalAllocated: number;
  /** Per-instance stats */
  instances: RedisInstanceStats[];
}

/**
 * Redis backend instance returned by createRedisBackend.
 */
export interface RedisBackendInstance {
  /** Get the backend config to pass to createLLMRateLimiter */
  getBackendConfig: () => BackendConfig;
  /** Stop the backend (cleanup intervals, disconnect if we created the client) */
  stop: () => Promise<void>;
  /** Get current stats for monitoring */
  getStats: () => Promise<RedisBackendStats>;
  /** Get job type stats (if resourcesPerJob configured) */
  getJobTypeStats: () => Promise<RedisJobTypeStats | undefined>;
  /** Acquire a job type slot */
  acquireJobType: (instanceId: string, jobTypeId: string) => Promise<boolean>;
  /** Release a job type slot */
  releaseJobType: (instanceId: string, jobTypeId: string) => Promise<void>;
}

/**
 * Per-model pool allocation (stored in Redis).
 * Pool-based: Redis tracks per-model capacity, local instances distribute across job types.
 */
export interface ModelPoolAllocationData {
  /** Total slots available for this model in this instance's pool */
  totalSlots: number;
  /** Per-instance tokens per minute limit for this model */
  tokensPerMinute: number;
  /** Per-instance requests per minute limit for this model */
  requestsPerMinute: number;
  /** Per-instance tokens per day limit for this model */
  tokensPerDay: number;
  /** Per-instance requests per day limit for this model */
  requestsPerDay: number;
}

/**
 * Pool allocation by model ID (stored in Redis).
 */
export type PoolsData = Record<string, ModelPoolAllocationData>;

/**
 * In-flight tracking by model (pool-based).
 */
export type InFlightByModel = Record<string, number>;

/**
 * Internal instance data stored in Redis.
 */
export interface InstanceData {
  /** Last heartbeat timestamp (ms since epoch) */
  lastHeartbeat: number;
  /** In-flight count per model (pool-based tracking) */
  inFlightByModel: InFlightByModel;
}

/**
 * Internal allocation data stored in Redis.
 */
export interface AllocationData {
  /** Number of active instances sharing the rate limits */
  instanceCount: number;
  /** Pool allocation per model (pool-based slot allocation) */
  pools: PoolsData;
}

/**
 * Job type state stored in Redis.
 */
export interface RedisJobTypeState {
  /** Current ratio (0-1) */
  currentRatio: number;
  /** Initial ratio (0-1) */
  initialRatio: number;
  /** Whether ratio is flexible */
  flexible: boolean;
  /** Total in-flight across all instances */
  totalInFlight: number;
  /** Allocated slots based on ratio and total capacity */
  allocatedSlots: number;
}

/**
 * Job type stats from Redis.
 */
export interface RedisJobTypeStats {
  /** Job type states keyed by job type ID */
  jobTypes: Record<string, RedisJobTypeState>;
}

/**
 * Type guard for checking if redis is an ioredis client.
 * Checks for presence of 'get' method which exists on Redis but not on connection options.
 */
export const isRedisClient = (redis: Redis | RedisConnectionOptions): redis is Redis => 'get' in redis;

/**
 * Type guard for checking if a backend config is a RedisBackendFactory.
 * Checks for presence of 'initialize' method which only exists on factory.
 */
/** Helper type for type guard */
interface HasInitialize {
  initialize: unknown;
}

export const isRedisBackendFactory = (backend: unknown): backend is RedisBackendFactory => {
  if (backend === null || typeof backend !== 'object') {
    return false;
  }
  if (!('initialize' in backend)) {
    return false;
  }
  const { initialize } = backend as HasInitialize;
  return typeof initialize === 'function';
};

/** Default keepalive interval for Redis connections (30 seconds) */
const DEFAULT_KEEPALIVE_MS = 30000;

/**
 * Convert RedisConnectionOptions to ioredis RedisOptions.
 */
export const toRedisOptions = (opts: RedisConnectionOptions): RedisOptions => ({
  host: opts.host,
  port: opts.port,
  password: opts.password,
  db: opts.db,
  tls: opts.tls === true ? {} : undefined,
  keepAlive: DEFAULT_KEEPALIVE_MS,
});

/** Exponential backoff constants for retry strategy */
const MAX_RETRY_DELAY_MS = 30000;
const BASE_DELAY_MS = 100;
const EXPONENT_BASE = 2;
const EXPONENT_OFFSET = 1;

/**
 * Options optimized for subscriber connections (pub/sub).
 * Includes aggressive reconnection and keepalive settings.
 */
export const subscriberOptions: Partial<RedisOptions> = {
  keepAlive: DEFAULT_KEEPALIVE_MS,
  retryStrategy: (times: number): number => {
    // Exponential backoff: 100ms, 200ms, 400ms... up to 30s
    const delay = Math.min(BASE_DELAY_MS * EXPONENT_BASE ** (times - EXPONENT_OFFSET), MAX_RETRY_DELAY_MS);
    return delay;
  },
};
