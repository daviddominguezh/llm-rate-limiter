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
  KEY_SUFFIX_JOB_TYPES,
  KEY_SUFFIX_JOB_TYPE_CHANNEL,
  KEY_SUFFIX_JOB_TYPE_INSTANCES,
  KEY_SUFFIX_MODEL_CAPACITIES,
  ZERO,
} from './constants.js';

/** Redis key collection for backend operations */
export interface RedisKeys {
  instances: string;
  allocations: string;
  config: string;
  channel: string;
  jobTypes: string;
  jobTypeInstances: string;
  jobTypeChannel: string;
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
  jobTypes: `${prefix}${KEY_SUFFIX_JOB_TYPES}`,
  jobTypeInstances: `${prefix}${KEY_SUFFIX_JOB_TYPE_INSTANCES}`,
  jobTypeChannel: `${prefix}${KEY_SUFFIX_JOB_TYPE_CHANNEL}`,
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

/** Configuration for initializing a job type in Redis */
export interface JobTypeInitConfig {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
}

const FULL_RATIO = 1;

/**
 * Build initialization data for job types based on resourceEstimationsPerJob config.
 * Calculates initial ratios similar to core JobTypeManager.
 */
export const buildJobTypesInitData = (
  resourceEstimationsPerJob: ResourceEstimationsPerJob
): Record<string, JobTypeInitConfig> => {
  const jobTypeIds = Object.keys(resourceEstimationsPerJob);
  let specifiedTotal = ZERO;
  const specifiedRatios = new Map<string, number>();
  for (const id of jobTypeIds) {
    const { ratio } = resourceEstimationsPerJob[id] ?? {};
    if (ratio?.initialValue !== undefined) {
      specifiedRatios.set(id, ratio.initialValue);
      specifiedTotal += ratio.initialValue;
    }
  }
  const remainingRatio = FULL_RATIO - specifiedTotal;
  const unspecifiedCount = jobTypeIds.length - specifiedRatios.size;
  const evenShare = unspecifiedCount > ZERO ? remainingRatio / unspecifiedCount : ZERO;
  const result: Record<string, JobTypeInitConfig> = {};
  for (const id of jobTypeIds) {
    const { ratio } = resourceEstimationsPerJob[id] ?? {};
    const ratioValue = specifiedRatios.get(id) ?? evenShare;
    const flexible = ratio?.flexible !== false;
    result[id] = { currentRatio: ratioValue, initialRatio: ratioValue, flexible };
  }
  return result;
};
