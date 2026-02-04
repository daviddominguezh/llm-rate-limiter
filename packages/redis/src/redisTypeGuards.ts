/**
 * Type guards and parsing utilities for the Redis backend.
 */
import type { AllocationInfo, DynamicLimits } from '@llm-rate-limiter/core';

import type { AllocationData, RedisBackendStats, RedisJobTypeStats } from './types.js';

export const isObject = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

export const isAllocationData = (d: unknown): d is AllocationData =>
  isObject(d) &&
  'instanceCount' in d &&
  typeof d.instanceCount === 'number' &&
  'pools' in d &&
  isObject(d.pools);

export const isParsedMessage = (d: unknown): d is { instanceId: string; allocation: string } =>
  isObject(d) && 'instanceId' in d && typeof d.instanceId === 'string';

export const isRedisBackendStats = (d: unknown): d is RedisBackendStats =>
  isObject(d) && 'totalInstances' in d;

export const isRedisJobTypeStats = (d: unknown): d is RedisJobTypeStats['jobTypes'] => isObject(d);

/** Type guard for DynamicLimits - validates structure of dynamic limits per model */
export const isDynamicLimits = (d: unknown): d is DynamicLimits => {
  if (!isObject(d)) return false;
  for (const modelLimits of Object.values(d)) {
    if (!isObject(modelLimits)) return false;
    const limits = modelLimits;
    if (limits.tokensPerMinute !== undefined && typeof limits.tokensPerMinute !== 'number') return false;
    if (limits.requestsPerMinute !== undefined && typeof limits.requestsPerMinute !== 'number') return false;
    if (limits.tokensPerDay !== undefined && typeof limits.tokensPerDay !== 'number') return false;
    if (limits.requestsPerDay !== undefined && typeof limits.requestsPerDay !== 'number') return false;
  }
  return true;
};

const DEFAULT_INSTANCE_COUNT = 1;
const defaultAlloc: AllocationInfo = {
  instanceCount: DEFAULT_INSTANCE_COUNT,
  pools: {},
};

export const parseAllocation = (json: string | null): AllocationInfo => {
  /* istanbul ignore if -- Defensive: allocation data should exist */
  if (json === null) return defaultAlloc;
  try {
    const parsed: unknown = JSON.parse(json);
    if (isAllocationData(parsed)) {
      const result: AllocationInfo = {
        instanceCount: parsed.instanceCount,
        pools: parsed.pools,
      };
      // Include dynamicLimits if present and valid
      if ('dynamicLimits' in parsed && isDynamicLimits(parsed.dynamicLimits)) {
        result.dynamicLimits = parsed.dynamicLimits;
      }
      return result;
    }
    return defaultAlloc;
  } catch {
    return defaultAlloc;
  }
};

export const parseJobTypeStats = (result: string): RedisJobTypeStats | undefined => {
  if (result === '') return undefined;
  const parsed: unknown = JSON.parse(result);
  if (!isRedisJobTypeStats(parsed)) return undefined;
  return { jobTypes: parsed };
};

export const ignoreError = (): void => {
  /* fire-and-forget */
};
