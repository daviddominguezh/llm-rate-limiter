/**
 * Helper functions and types for the Redis backend.
 */
import type { ResourceEstimationsPerJob } from '@llm-rate-limiter/core';
import type { Redis as RedisType } from 'ioredis';

import {
  KEY_SUFFIX_ALLOCATIONS,
  KEY_SUFFIX_CHANNEL,
  KEY_SUFFIX_CONFIG,
  KEY_SUFFIX_INSTANCES,
  KEY_SUFFIX_JOB_TYPE_RESOURCES,
  KEY_SUFFIX_MODEL_CAPACITIES,
} from './constants.js';

/** Redis key collection for backend operations */
export interface RedisKeys {
  instances: string;
  allocations: string;
  config: string;
  channel: string;
  /** Key for multi-dimensional model capacities config */
  modelCapacities: string;
  /** Key for multi-dimensional job type resources config */
  jobTypeResources: string;
}

/** Build all Redis keys from a prefix */
export const buildKeys = (prefix: string): RedisKeys => ({
  instances: `${prefix}${KEY_SUFFIX_INSTANCES}`,
  allocations: `${prefix}${KEY_SUFFIX_ALLOCATIONS}`,
  config: `${prefix}${KEY_SUFFIX_CONFIG}`,
  channel: `${prefix}${KEY_SUFFIX_CHANNEL}`,
  modelCapacities: `${prefix}${KEY_SUFFIX_MODEL_CAPACITIES}`,
  jobTypeResources: `${prefix}${KEY_SUFFIX_JOB_TYPE_RESOURCES}`,
});

/** Configuration for backend operations */
export interface BackendOperationConfig {
  totalCapacity: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  heartbeatIntervalMs: number;
  instanceTimeoutMs: number;
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
}

/** Execute a Lua script and return string result */
export const evalScript = async (
  redis: RedisType,
  script: string,
  keys: string[],
  args: string[]
): Promise<string> => {
  const result: unknown = await redis.eval(script, keys.length, ...keys, ...args);
  return typeof result === 'string' ? result : '';
};
