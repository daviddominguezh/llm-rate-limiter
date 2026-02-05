/**
 * Memory management for the LLM Rate Limiter.
 * Uses per-job-type semaphores where each job type gets a share of total memory
 * based on its ratio. When ratios change dynamically, memory pools resize accordingly.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { AvailabilityChangeReason, LLMRateLimiterConfig } from '../multiModelTypes.js';
import type { InternalLimiterStats, LogFn } from '../types.js';
import { calculateInitialRatios } from './jobTypeValidation.js';
import { getAvailableMemoryKB } from './memoryUtils.js';
import { Semaphore } from './semaphore.js';

const ZERO = 0;
const ONE = 1;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const MEMORY_REASON: AvailabilityChangeReason = 'memory';

/** Memory manager configuration */
export interface MemoryManagerConfig {
  config: LLMRateLimiterConfig;
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  label: string;
  onLog?: LogFn;
  onAvailabilityChange?: (reason: AvailabilityChangeReason, modelId: string) => void;
}

/** Memory manager instance */
export interface MemoryManagerInstance {
  hasCapacity: (jobType: string) => boolean;
  acquire: (jobType: string) => Promise<void>;
  release: (jobType: string) => void;
  setRatios: (ratios: Map<string, number>) => void;
  getStats: () => InternalLimiterStats['memory'] | undefined;
  stop: () => void;
}

/** State for a single job type's memory pool */
interface JobTypeMemoryState {
  semaphore: Semaphore;
  estimatedUsedMemoryKB: number;
  currentRatio: number;
  allocatedMemoryKB: number;
}

/** Per-job-type memory manager implementation */
class PerJobTypeMemoryManager implements MemoryManagerInstance {
  private readonly jobTypeStates: Map<string, JobTypeMemoryState>;
  private readonly freeMemoryRatio: number;
  private readonly onAvailabilityChange?: (reason: AvailabilityChangeReason, modelId: string) => void;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;
  private totalMemoryKB: number;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(managerConfig: MemoryManagerConfig) {
    const { config, resourceEstimationsPerJob, label, onLog, onAvailabilityChange } = managerConfig;

    this.freeMemoryRatio = config.memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
    this.totalMemoryKB = Math.floor(getAvailableMemoryKB() * this.freeMemoryRatio);
    this.onAvailabilityChange = onAvailabilityChange;
    this.log = onLog !== undefined ? (msg, data) => onLog(`${label}| ${msg}`, data) : () => undefined;
    this.jobTypeStates = new Map();

    // Calculate initial ratios using the same logic as JobTypeManager
    const calculated = calculateInitialRatios(resourceEstimationsPerJob);
    const jobTypeCount = Object.keys(resourceEstimationsPerJob).length;
    const defaultRatio = jobTypeCount > ZERO ? ONE / jobTypeCount : ONE;

    // Create per-job-type semaphores
    for (const [jobType, jobConfig] of Object.entries(resourceEstimationsPerJob)) {
      const ratio = calculated.ratios.get(jobType) ?? defaultRatio;
      const allocatedMemoryKB = Math.floor(this.totalMemoryKB * ratio);
      const estimatedUsedMemoryKB = jobConfig.estimatedUsedMemoryKB ?? ZERO;

      this.jobTypeStates.set(jobType, {
        semaphore: new Semaphore(Math.max(ONE, allocatedMemoryKB), `${label}/Memory/${jobType}`, onLog),
        estimatedUsedMemoryKB,
        currentRatio: ratio,
        allocatedMemoryKB,
      });
    }

    this.log('PerJobTypeMemoryManager initialized', {
      totalMemoryKB: this.totalMemoryKB,
      jobTypes: Array.from(this.jobTypeStates.keys()),
      allocations: Object.fromEntries(
        Array.from(this.jobTypeStates.entries()).map(([id, s]) => [id, s.allocatedMemoryKB])
      ),
    });

    // Start periodic memory recalculation
    this.startRecalculationInterval(
      config.memory?.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS
    );
  }

  private startRecalculationInterval(intervalMs: number): void {
    this.intervalId = setInterval(() => {
      const newTotalMemory = Math.floor(getAvailableMemoryKB() * this.freeMemoryRatio);
      if (newTotalMemory !== this.totalMemoryKB) {
        this.totalMemoryKB = newTotalMemory;
        this.resizeAllPools();
        this.onAvailabilityChange?.(MEMORY_REASON, '*');
      }
    }, intervalMs);
  }

  /** Resize all pools based on current ratios and total memory */
  private resizeAllPools(): void {
    for (const [jobType, state] of this.jobTypeStates) {
      const newAllocatedKB = Math.floor(this.totalMemoryKB * state.currentRatio);
      if (newAllocatedKB !== state.allocatedMemoryKB) {
        state.allocatedMemoryKB = newAllocatedKB;
        state.semaphore.resize(Math.max(ONE, newAllocatedKB));
        this.log(`Resized memory pool for ${jobType}`, {
          allocatedMemoryKB: newAllocatedKB,
          ratio: state.currentRatio,
        });
      }
    }
  }

  hasCapacity(jobType: string): boolean {
    const state = this.jobTypeStates.get(jobType);
    if (state === undefined) {
      return true; // Unknown job type = no memory limit
    }
    if (state.estimatedUsedMemoryKB === ZERO) {
      return true; // No memory estimate = always has capacity
    }
    return state.semaphore.getAvailablePermits() >= state.estimatedUsedMemoryKB;
  }

  async acquire(jobType: string): Promise<void> {
    const state = this.jobTypeStates.get(jobType);
    if (state === undefined || state.estimatedUsedMemoryKB === ZERO) {
      return;
    }
    await state.semaphore.acquire(state.estimatedUsedMemoryKB);
    this.onAvailabilityChange?.(MEMORY_REASON, '*');
  }

  release(jobType: string): void {
    const state = this.jobTypeStates.get(jobType);
    if (state === undefined || state.estimatedUsedMemoryKB === ZERO) {
      return;
    }
    state.semaphore.release(state.estimatedUsedMemoryKB);
    this.onAvailabilityChange?.(MEMORY_REASON, '*');
  }

  setRatios(ratios: Map<string, number>): void {
    // Update ratios and resize pools
    for (const [jobType, newRatio] of ratios) {
      const state = this.jobTypeStates.get(jobType);
      if (state === undefined) continue;

      state.currentRatio = newRatio;
      const newAllocatedKB = Math.floor(this.totalMemoryKB * newRatio);
      if (newAllocatedKB !== state.allocatedMemoryKB) {
        state.allocatedMemoryKB = newAllocatedKB;
        state.semaphore.resize(Math.max(ONE, newAllocatedKB));
      }
    }

    this.log('Ratios updated', {
      ratios: Object.fromEntries(ratios),
      allocations: Object.fromEntries(
        Array.from(this.jobTypeStates.entries()).map(([id, s]) => [id, s.allocatedMemoryKB])
      ),
    });

    this.onAvailabilityChange?.(MEMORY_REASON, '*');
  }

  getStats(): InternalLimiterStats['memory'] | undefined {
    // Aggregate stats across all job type pools
    let totalActive = ZERO;
    let totalMax = ZERO;
    let totalAvailable = ZERO;

    for (const state of this.jobTypeStates.values()) {
      const stats = state.semaphore.getStats();
      totalActive += stats.inUse;
      totalMax += stats.max;
      totalAvailable += stats.available;
    }

    return {
      activeKB: totalActive,
      maxCapacityKB: totalMax,
      availableKB: totalAvailable,
      systemAvailableKB: Math.round(getAvailableMemoryKB()),
    };
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.log('PerJobTypeMemoryManager stopped');
  }
}

/** Create a memory manager instance with per-job-type semaphores */
export const createMemoryManager = (managerConfig: MemoryManagerConfig): MemoryManagerInstance | null => {
  const { config, resourceEstimationsPerJob } = managerConfig;

  if (config.memory === undefined) {
    return null;
  }

  // Check if any job type has memory estimate
  const hasMemoryEstimates = Object.values(resourceEstimationsPerJob).some(
    (jobConfig) => jobConfig.estimatedUsedMemoryKB !== undefined && jobConfig.estimatedUsedMemoryKB > ZERO
  );

  if (!hasMemoryEstimates) {
    return null;
  }

  return new PerJobTypeMemoryManager(managerConfig);
};

/** Reset shared state (for testing purposes only) */
export const resetSharedMemoryState = (): void => {
  // No longer using shared state, but keep for API compatibility
};
