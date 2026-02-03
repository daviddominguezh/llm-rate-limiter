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
  onAvailabilityChange?: (reason: AvailabilityChangeReason, modelId: string) => void;
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
  availabilityCallbacks: Set<(reason: AvailabilityChangeReason, modelId: string) => void>;
  freeMemoryRatio: number;
  minCapacity: number | undefined;
  maxCapacity: number | undefined;
}

let sharedState: SharedMemoryState | null = null;

/** Extract capacity bounds from models config (uses minimum across all models) */
const extractCapacityBounds = (
  config: LLMRateLimiterConfig
): { minCapacity: number | undefined; maxCapacity: number | undefined } => {
  let minCapacity: number | undefined;
  let maxCapacity: number | undefined;

  for (const modelConfig of Object.values(config.models)) {
    if (modelConfig.minCapacity !== undefined) {
      minCapacity =
        minCapacity === undefined ? modelConfig.minCapacity : Math.min(minCapacity, modelConfig.minCapacity);
    }
    if (modelConfig.maxCapacity !== undefined) {
      maxCapacity =
        maxCapacity === undefined ? modelConfig.maxCapacity : Math.min(maxCapacity, modelConfig.maxCapacity);
    }
  }

  return { minCapacity, maxCapacity };
};

/** Calculate memory capacity based on shared config and available memory */
const calculateCapacity = (
  freeMemoryRatio: number,
  minCapacity: number | undefined,
  maxCapacity: number | undefined
): number => {
  const availableKB = getAvailableMemoryKB();
  const calculated = Math.floor(availableKB * freeMemoryRatio);
  let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
  if (maxCapacity !== undefined) {
    clamped = Math.min(clamped, maxCapacity);
  }
  return clamped;
};

/** Initialize or get the shared memory state */
const getOrCreateSharedState = (
  config: LLMRateLimiterConfig,
  label: string,
  onLog?: LogFn
): SharedMemoryState => {
  if (sharedState !== null) {
    sharedState.referenceCount += ONE;
    return sharedState;
  }

  const freeMemoryRatio = config.memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
  const { minCapacity, maxCapacity } = extractCapacityBounds(config);
  const recalculationIntervalMs = config.memory?.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;

  const semaphore = new Semaphore(
    calculateCapacity(freeMemoryRatio, minCapacity, maxCapacity),
    `${label}/Memory`,
    onLog
  );
  const availabilityCallbacks = new Set<(reason: AvailabilityChangeReason, modelId: string) => void>();

  const intervalId = setInterval(() => {
    const newCapacity = calculateCapacity(freeMemoryRatio, minCapacity, maxCapacity);
    if (newCapacity !== semaphore.getStats().max) {
      semaphore.resize(newCapacity);
      for (const callback of availabilityCallbacks) {
        callback(MEMORY_REASON, '*');
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
const releaseSharedState = (callback?: (reason: AvailabilityChangeReason, modelId: string) => void): void => {
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
const createHasCapacity =
  (state: SharedMemoryState, estimatedMemoryKB: number): MemoryManagerInstance['hasCapacity'] =>
  (_modelId) =>
    state.semaphore.getAvailablePermits() >= estimatedMemoryKB;

/** Create acquire function */
const createAcquire =
  (
    state: SharedMemoryState,
    estimatedMemoryKB: number,
    onAvailabilityChange?: (reason: AvailabilityChangeReason, modelId: string) => void
  ): MemoryManagerInstance['acquire'] =>
  async (modelId) => {
    if (estimatedMemoryKB > ZERO) {
      await state.semaphore.acquire(estimatedMemoryKB);
      onAvailabilityChange?.(MEMORY_REASON, modelId);
    }
  };

/** Create release function */
const createRelease =
  (
    state: SharedMemoryState,
    estimatedMemoryKB: number,
    onAvailabilityChange?: (reason: AvailabilityChangeReason, modelId: string) => void
  ): MemoryManagerInstance['release'] =>
  (modelId) => {
    if (estimatedMemoryKB > ZERO) {
      state.semaphore.release(estimatedMemoryKB);
      onAvailabilityChange?.(MEMORY_REASON, modelId);
    }
  };

/** Create getStats function */
const createGetStats =
  (state: SharedMemoryState): MemoryManagerInstance['getStats'] =>
  () => {
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
      'resourcesPerJob.estimatedUsedMemoryKB is required in at least one job type when memory limits are configured'
    );
  }

  const state = getOrCreateSharedState(config, label, onLog);

  // Register callback for interval-based capacity changes
  if (onAvailabilityChange !== undefined) {
    state.availabilityCallbacks.add(onAvailabilityChange);
  }

  return {
    hasCapacity: createHasCapacity(state, estimatedUsedMemoryKB),
    acquire: createAcquire(state, estimatedUsedMemoryKB, onAvailabilityChange),
    release: createRelease(state, estimatedUsedMemoryKB, onAvailabilityChange),
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
