/**
 * Memory management for the LLM Rate Limiter.
 * Uses a singleton semaphore shared across all rate limiter instances in the same process.
 */
import type { AvailabilityChangeReason, LLMRateLimiterConfig } from '../multiModelTypes.js';
import type { InternalLimiterStats, LogFn } from '../types.js';
import { getAvailableMemoryKB } from './memoryUtils.js';
import { Semaphore } from './semaphore.js';

const ZERO = 0;
const ONE = 1;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const MEMORY_REASON: AvailabilityChangeReason = 'memory';

/** Memory manager configuration */
export interface MemoryManagerConfig {
  config: LLMRateLimiterConfig;
  label: string;
  estimatedUsedMemoryKB: number;
  onLog?: LogFn;
  onAvailabilityChange?: (reason: AvailabilityChangeReason) => void;
}

/** Memory manager instance */
export interface MemoryManagerInstance {
  hasCapacity: (modelId: string) => boolean;
  acquire: (modelId: string) => Promise<void>;
  release: (modelId: string) => void;
  getStats: () => InternalLimiterStats['memory'] | undefined;
  stop: () => void;
}

/** Singleton state for shared memory management */
interface SharedMemoryState {
  semaphore: Semaphore;
  intervalId: NodeJS.Timeout;
  referenceCount: number;
  availabilityCallbacks: Set<(reason: AvailabilityChangeReason) => void>;
  freeMemoryRatio: number;
  minCapacity: number | undefined;
  maxCapacity: number | undefined;
}

let sharedState: SharedMemoryState | null = null;

/** Calculate memory capacity based on shared config and available memory */
const calculateCapacity = (
  freeMemoryRatio: number,
  minCapacity: number | undefined,
  maxCapacity: number | undefined
): number => {
  const calculated = Math.floor(getAvailableMemoryKB() * freeMemoryRatio);
  let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
  if (maxCapacity !== undefined) {
    clamped = Math.min(clamped, maxCapacity);
  }
  return clamped;
};

/** Get estimated memory for a specific model */
const getEstimatedMemory = (config: LLMRateLimiterConfig, modelId: string): number =>
  config.models[modelId]?.resourcesPerEvent?.estimatedUsedMemoryKB ?? ZERO;

/** Initialize or get the shared memory state */
const getOrCreateSharedState = (config: LLMRateLimiterConfig, label: string, onLog?: LogFn): SharedMemoryState => {
  if (sharedState !== null) {
    sharedState.referenceCount += ONE;
    return sharedState;
  }

  const freeMemoryRatio = config.memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
  const { minCapacity, maxCapacity } = config;
  const recalculationIntervalMs = config.memory?.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;

  const semaphore = new Semaphore(calculateCapacity(freeMemoryRatio, minCapacity, maxCapacity), `${label}/Memory`, onLog);
  const availabilityCallbacks = new Set<(reason: AvailabilityChangeReason) => void>();

  const intervalId = setInterval(() => {
    const newCapacity = calculateCapacity(freeMemoryRatio, minCapacity, maxCapacity);
    if (newCapacity !== semaphore.getStats().max) {
      semaphore.resize(newCapacity);
      for (const callback of availabilityCallbacks) {
        callback(MEMORY_REASON);
      }
    }
  }, recalculationIntervalMs);

  sharedState = {
    semaphore,
    intervalId,
    referenceCount: ONE,
    availabilityCallbacks,
    freeMemoryRatio,
    minCapacity,
    maxCapacity,
  };

  return sharedState;
};

/** Release reference to shared state, cleanup if last reference */
const releaseSharedState = (callback?: (reason: AvailabilityChangeReason) => void): void => {
  if (sharedState === null) {
    return;
  }

  if (callback !== undefined) {
    sharedState.availabilityCallbacks.delete(callback);
  }

  sharedState.referenceCount -= ONE;
  if (sharedState.referenceCount <= ZERO) {
    clearInterval(sharedState.intervalId);
    sharedState = null;
  }
};

/** Create hasCapacity function */
const createHasCapacity = (
  state: SharedMemoryState,
  config: LLMRateLimiterConfig
): MemoryManagerInstance['hasCapacity'] => (modelId) =>
  state.semaphore.getAvailablePermits() >= getEstimatedMemory(config, modelId);

/** Create acquire function */
const createAcquire = (
  state: SharedMemoryState,
  config: LLMRateLimiterConfig,
  onAvailabilityChange?: (reason: AvailabilityChangeReason) => void
): MemoryManagerInstance['acquire'] => async (modelId) => {
  const mem = getEstimatedMemory(config, modelId);
  if (mem > ZERO) {
    await state.semaphore.acquire(mem);
    onAvailabilityChange?.(MEMORY_REASON);
  }
};

/** Create release function */
const createRelease = (
  state: SharedMemoryState,
  config: LLMRateLimiterConfig,
  onAvailabilityChange?: (reason: AvailabilityChangeReason) => void
): MemoryManagerInstance['release'] => (modelId) => {
  const mem = getEstimatedMemory(config, modelId);
  if (mem > ZERO) {
    state.semaphore.release(mem);
    onAvailabilityChange?.(MEMORY_REASON);
  }
};

/** Create getStats function */
const createGetStats = (state: SharedMemoryState): MemoryManagerInstance['getStats'] => () => {
  const { inUse, max, available } = state.semaphore.getStats();
  return {
    activeKB: inUse,
    maxCapacityKB: max,
    availableKB: available,
    systemAvailableKB: Math.round(getAvailableMemoryKB()),
  };
};

/** Create a memory manager instance (shares underlying semaphore with other instances) */
export const createMemoryManager = (managerConfig: MemoryManagerConfig): MemoryManagerInstance | null => {
  const { config, label, estimatedUsedMemoryKB, onLog, onAvailabilityChange } = managerConfig;
  if (config.memory === undefined) {
    return null;
  }
  if (estimatedUsedMemoryKB === ZERO) {
    throw new Error(
      'resourcesPerEvent.estimatedUsedMemoryKB is required in at least one model when memory limits are configured'
    );
  }

  const state = getOrCreateSharedState(config, label, onLog);

  // Register callback for interval-based capacity changes
  if (onAvailabilityChange !== undefined) {
    state.availabilityCallbacks.add(onAvailabilityChange);
  }

  return {
    hasCapacity: createHasCapacity(state, config),
    acquire: createAcquire(state, config, onAvailabilityChange),
    release: createRelease(state, config, onAvailabilityChange),
    getStats: createGetStats(state),
    stop: (): void => {
      releaseSharedState(onAvailabilityChange);
    },
  };
};

/** Reset shared state (for testing purposes only) */
export const resetSharedMemoryState = (): void => {
  if (sharedState !== null) {
    clearInterval(sharedState.intervalId);
    sharedState = null;
  }
};
