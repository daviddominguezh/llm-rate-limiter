/**
 * Memory management for the LLM Rate Limiter.
 */
import type { AvailabilityChangeReason, LLMRateLimiterConfig } from '../multiModelTypes.js';
import type { InternalLimiterStats, LogFn } from '../types.js';
import { getAvailableMemoryKB } from './memoryUtils.js';
import { Semaphore } from './semaphore.js';

const ZERO = 0;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;

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

/** Calculate memory capacity based on config and available memory */
const calculateCapacity = (config: LLMRateLimiterConfig): number => {
  const { memory, minCapacity, maxCapacity } = config;
  const calculated = Math.floor(
    getAvailableMemoryKB() * (memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO)
  );
  let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
  if (maxCapacity !== undefined) {
    clamped = Math.min(clamped, maxCapacity);
  }
  return clamped;
};

/** Get estimated memory for a specific model */
const getEstimatedMemory = (config: LLMRateLimiterConfig, modelId: string): number =>
  config.models[modelId]?.resourcesPerEvent?.estimatedUsedMemoryKB ?? ZERO;

/** Create hasCapacity function */
const createHasCapacity = (
  semaphore: Semaphore,
  config: LLMRateLimiterConfig
): MemoryManagerInstance['hasCapacity'] => (modelId) =>
  semaphore.getAvailablePermits() >= getEstimatedMemory(config, modelId);

/** Create acquire function */
const createAcquire = (
  semaphore: Semaphore,
  config: LLMRateLimiterConfig,
  onAvailabilityChange?: (reason: AvailabilityChangeReason) => void
): MemoryManagerInstance['acquire'] => async (modelId) => {
  const mem = getEstimatedMemory(config, modelId);
  if (mem > ZERO) {
    await semaphore.acquire(mem);
    onAvailabilityChange?.('memory');
  }
};

/** Create release function */
const createRelease = (
  semaphore: Semaphore,
  config: LLMRateLimiterConfig,
  onAvailabilityChange?: (reason: AvailabilityChangeReason) => void
): MemoryManagerInstance['release'] => (modelId) => {
  const mem = getEstimatedMemory(config, modelId);
  if (mem > ZERO) {
    semaphore.release(mem);
    onAvailabilityChange?.('memory');
  }
};

/** Create getStats function */
const createGetStats = (semaphore: Semaphore): MemoryManagerInstance['getStats'] => () => {
  const { inUse, max, available } = semaphore.getStats();
  return {
    activeKB: inUse,
    maxCapacityKB: max,
    availableKB: available,
    systemAvailableKB: Math.round(getAvailableMemoryKB()),
  };
};

/** Create a memory manager instance */
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
  const semaphore = new Semaphore(calculateCapacity(config), `${label}/Memory`, onLog);
  const intervalId = setInterval(() => {
    const newCapacity = calculateCapacity(config);
    if (newCapacity !== semaphore.getStats().max) {
      semaphore.resize(newCapacity);
      onAvailabilityChange?.('memory');
    }
  }, config.memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS);
  return {
    hasCapacity: createHasCapacity(semaphore, config),
    acquire: createAcquire(semaphore, config, onAvailabilityChange),
    release: createRelease(semaphore, config, onAvailabilityChange),
    getStats: createGetStats(semaphore),
    stop: (): void => { clearInterval(intervalId); },
  };
};
