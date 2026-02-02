/**
 * Type guards and parsing utilities for the Redis backend.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { ZERO } from './constants.js';
import type { AllocationData, RedisBackendStats, RedisJobTypeStats } from './types.js';

export const isObject = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

export const isAllocationData = (d: unknown): d is AllocationData =>
  isObject(d) && 'slots' in d && typeof d.slots === 'number';

export const isParsedMessage = (d: unknown): d is { instanceId: string; allocation: string } =>
  isObject(d) && 'instanceId' in d && typeof d.instanceId === 'string';

export const isRedisBackendStats = (d: unknown): d is RedisBackendStats =>
  isObject(d) && 'totalInstances' in d;

export const isRedisJobTypeStats = (d: unknown): d is RedisJobTypeStats['jobTypes'] => isObject(d);

const defaultAlloc: AllocationInfo = { slots: ZERO, tokensPerMinute: ZERO, requestsPerMinute: ZERO };

export const parseAllocation = (json: string | null): AllocationInfo => {
  /* istanbul ignore if -- Defensive: allocation data should exist */
  if (json === null) return defaultAlloc;
  const parsed: unknown = JSON.parse(json);
  /* istanbul ignore if -- Defensive: Lua script returns valid allocation */
  if (!isAllocationData(parsed)) return defaultAlloc;
  return {
    slots: parsed.slots,
    tokensPerMinute: parsed.tokensPerMinute,
    requestsPerMinute: parsed.requestsPerMinute,
  };
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
