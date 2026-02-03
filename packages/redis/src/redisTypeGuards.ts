/**
 * Type guards and parsing utilities for the Redis backend.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import { ZERO } from './constants.js';
import type { AllocationData, RedisBackendStats, RedisJobTypeStats } from './types.js';

export const isObject = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;

/** Check if data has required slots field */
export const hasSlots = (d: unknown): d is { slots: number } =>
  isObject(d) && 'slots' in d && typeof d.slots === 'number';

export const isAllocationData = (d: unknown): d is AllocationData =>
  hasSlots(d) && 'instanceCount' in d && typeof d.instanceCount === 'number';

export const isParsedMessage = (d: unknown): d is { instanceId: string; allocation: string } =>
  isObject(d) && 'instanceId' in d && typeof d.instanceId === 'string';

export const isRedisBackendStats = (d: unknown): d is RedisBackendStats =>
  isObject(d) && 'totalInstances' in d;

export const isRedisJobTypeStats = (d: unknown): d is RedisJobTypeStats['jobTypes'] => isObject(d);

const DEFAULT_INSTANCE_COUNT = 1;
const defaultAlloc: AllocationInfo = { slots: ZERO, instanceCount: DEFAULT_INSTANCE_COUNT };

export const parseAllocation = (json: string | null): AllocationInfo => {
  /* istanbul ignore if -- Defensive: allocation data should exist */
  if (json === null) return defaultAlloc;
  try {
    const parsed: unknown = JSON.parse(json);
    /* Handle both new format (with instanceCount) and old format (without) */
    if (isAllocationData(parsed)) {
      return {
        slots: parsed.slots,
        instanceCount: parsed.instanceCount,
      };
    }
    /* Fallback for old format - extract slots, default instanceCount to 1 */
    if (hasSlots(parsed)) {
      return {
        slots: parsed.slots,
        instanceCount: DEFAULT_INSTANCE_COUNT,
      };
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
