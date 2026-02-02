/**
 * Type definitions for the Redis distributed backend.
 */
import type { DistributedBackendConfig, ResourcesPerJob } from '@llm-rate-limiter/core';
import type { Redis, RedisOptions } from 'ioredis';

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
 * Configuration for creating a Redis distributed backend.
 */
export interface RedisBackendConfig {
  /** Redis connection (ioredis client or connection options) */
  redis: Redis | RedisConnectionOptions;
  /** Total capacity (concurrent slots) across all instances */
  totalCapacity: number;
  /** Total tokens per minute across all instances (optional) */
  tokensPerMinute?: number;
  /** Total requests per minute across all instances (optional) */
  requestsPerMinute?: number;
  /** Key prefix for Redis keys (default: 'llm-rl:') */
  keyPrefix?: string;
  /** Heartbeat interval in ms (default: 5000) */
  heartbeatIntervalMs?: number;
  /** Instance timeout in ms (default: 15000) - instances not seen for this long are cleaned up */
  instanceTimeoutMs?: number;
  /** Job type configuration for distributed job type capacity (optional) */
  resourcesPerJob?: ResourcesPerJob;
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
  getBackendConfig: () => DistributedBackendConfig;
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
 * Internal instance data stored in Redis.
 */
export interface InstanceData {
  /** Number of in-flight jobs */
  inFlight: number;
  /** Last heartbeat timestamp (ms since epoch) */
  lastHeartbeat: number;
}

/**
 * Internal allocation data stored in Redis.
 */
export interface AllocationData {
  /** Allocated slots */
  slots: number;
  /** Allocated tokens per minute */
  tokensPerMinute: number;
  /** Allocated requests per minute */
  requestsPerMinute: number;
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
