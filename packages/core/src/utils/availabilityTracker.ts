/**
 * Tracks availability changes and emits callbacks when slots change.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  AllocationInfo,
  Availability,
  AvailabilityChangeReason,
  LLMRateLimiterStats,
  OnAvailableSlotsChange,
  Pools,
  RelativeAvailabilityAdjustment,
} from '../multiModelTypes.js';
import type { InternalLimiterStats } from '../types.js';

const ZERO = 0;
const ONE = 1;
const DEFAULT_RATIO = 1;

/** Estimated resources per job, used to calculate available slots */
export interface EstimatedResources {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  estimatedUsedMemoryKB: number;
}

/** Capacity bounds for a single model */
export interface ModelCapacityBound {
  minCapacity?: number;
  maxCapacity?: number;
}

/** Capacity bounds per model ID */
export type ModelCapacityBounds = Record<string, ModelCapacityBound>;

/** Configuration for the availability tracker */
export interface AvailabilityTrackerConfig {
  callback: OnAvailableSlotsChange | undefined;
  getStats: () => LLMRateLimiterStats;
  estimatedResources: EstimatedResources;
  /** Resource estimations per job type (needed for per-job-type memory calculation) */
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
  /** Capacity bounds (minCapacity/maxCapacity) per model */
  modelCapacityBounds?: ModelCapacityBounds;
}

/** Helper to get minimum value across models for a stat */
const getMinRemaining = (
  models: Record<string, InternalLimiterStats>,
  getter: (stats: InternalLimiterStats) => number | undefined
): number | null => {
  let min: number | null = null;
  for (const modelStats of Object.values(models)) {
    const value = getter(modelStats);
    if (value !== undefined) {
      min = min === null ? value : Math.min(min, value);
    }
  }
  return min;
};

/** Compare two availability objects for equality */
const availabilityEquals = (a: Availability, b: Availability): boolean =>
  a.slots === b.slots &&
  a.tokensPerMinute === b.tokensPerMinute &&
  a.tokensPerDay === b.tokensPerDay &&
  a.requestsPerMinute === b.requestsPerMinute &&
  a.requestsPerDay === b.requestsPerDay &&
  a.concurrentRequests === b.concurrentRequests &&
  a.memoryKB === b.memoryKB;

/** Determine the reason based on what changed (priority order) */
const determineReason = (prev: Availability, curr: Availability): AvailabilityChangeReason => {
  if (prev.tokensPerMinute !== curr.tokensPerMinute) return 'tokensMinute';
  if (prev.tokensPerDay !== curr.tokensPerDay) return 'tokensDay';
  if (prev.requestsPerMinute !== curr.requestsPerMinute) return 'requestsMinute';
  if (prev.requestsPerDay !== curr.requestsPerDay) return 'requestsDay';
  if (prev.concurrentRequests !== curr.concurrentRequests) return 'concurrentRequests';
  // Slots are derived from the fields above plus memory. If we reach here, memory changed.
  return 'memory';
};

/** Add slot candidate if value and divisor are valid */
const addSlotCandidate = (slots: number[], value: number | null, divisor: number): void => {
  if (value !== null && divisor > ZERO) slots.push(Math.floor(value / divisor));
};

/** Sum total slots across all model pools from distributed allocation */
const sumPoolSlots = (pools: Pools): number => {
  let total = ZERO;
  for (const pool of Object.values(pools)) {
    total += pool.totalSlots;
  }
  return total;
};

/**
 * Apply memory constraint (scaling) and then per-model clamping to pools.
 * Flow:
 *   1. Sum pool slots (no clamping) to get poolTotal
 *   2. constrainedTotal = min(poolTotal, memorySlots)
 *   3. scaleFactor = constrainedTotal / poolTotal
 *   4. For each model: clamp(floor(totalSlots * scaleFactor), minCapacity, maxCapacity)
 *   5. Return sum of clamped values
 */
const applyMemoryConstraintAndClamping = (
  pools: Pools,
  memorySlots: number,
  bounds: ModelCapacityBounds | undefined
): number => {
  // Step 1: Sum pool slots without clamping
  const poolTotal = sumPoolSlots(pools);
  if (poolTotal === ZERO) {
    // No pool slots - apply minCapacity for each model
    let total = ZERO;
    for (const modelId of Object.keys(pools)) {
      const minCap = bounds?.[modelId]?.minCapacity ?? ZERO;
      total += minCap;
    }
    return total;
  }

  // Step 2-3: Calculate scale factor from memory constraint
  const constrainedTotal = Math.min(poolTotal, memorySlots);
  const scaleFactor = constrainedTotal / poolTotal;

  // Step 4-5: Scale each model's slots, then clamp, then sum
  let total = ZERO;
  for (const [modelId, pool] of Object.entries(pools)) {
    const scaledSlots = Math.floor(pool.totalSlots * scaleFactor);
    const modelBounds = bounds?.[modelId];
    const minCap = modelBounds?.minCapacity ?? ZERO;
    const maxCap = modelBounds?.maxCapacity ?? Number.POSITIVE_INFINITY;
    const clamped = Math.max(minCap, Math.min(maxCap, scaledSlots));
    total += clamped;
  }
  return total;
};

/** Calculate the number of slots (minimum jobs that can run) */
const calculateSlots = (availability: Availability, estimated: EstimatedResources): number => {
  const { tokensPerMinute, tokensPerDay, requestsPerMinute, requestsPerDay, concurrentRequests, memoryKB } =
    availability;
  const { estimatedUsedTokens, estimatedNumberOfRequests, estimatedUsedMemoryKB } = estimated;
  const slots: number[] = [];
  addSlotCandidate(slots, tokensPerMinute, estimatedUsedTokens);
  addSlotCandidate(slots, tokensPerDay, estimatedUsedTokens);
  addSlotCandidate(slots, requestsPerMinute, estimatedNumberOfRequests);
  addSlotCandidate(slots, requestsPerDay, estimatedNumberOfRequests);
  if (concurrentRequests !== null) slots.push(concurrentRequests);
  addSlotCandidate(slots, memoryKB, estimatedUsedMemoryKB);
  return slots.length === ZERO ? Number.POSITIVE_INFINITY : Math.max(ZERO, Math.min(...slots));
};

/** Utility class to track availability changes and emit callbacks */
export class AvailabilityTracker {
  private previousAvailability: Availability | null = null;
  private readonly callback: OnAvailableSlotsChange | undefined;
  private readonly getStats: () => LLMRateLimiterStats;
  private readonly estimated: EstimatedResources;
  private readonly resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined;
  private readonly modelCapacityBounds: ModelCapacityBounds | undefined;
  private distributedAllocation: AllocationInfo | null = null;

  constructor(config: AvailabilityTrackerConfig) {
    const { callback, getStats, estimatedResources, resourceEstimationsPerJob, modelCapacityBounds } = config;
    this.callback = callback;
    this.getStats = getStats;
    this.estimated = estimatedResources;
    this.resourceEstimationsPerJob = resourceEstimationsPerJob;
    this.modelCapacityBounds = modelCapacityBounds;
  }

  /**
   * Set the distributed allocation for this instance.
   * Called when the V2 backend pushes an allocation update.
   * @param allocation - The new allocation info
   * @param modelId - The model that triggered the allocation change (use '*' for global changes)
   */
  setDistributedAllocation(allocation: AllocationInfo, modelId = '*'): void {
    this.distributedAllocation = allocation;
    this.checkAndEmit('distributed', modelId);
  }

  /** Get the current distributed allocation (for testing/inspection) */
  getDistributedAllocation(): AllocationInfo | null {
    return this.distributedAllocation;
  }

  /** Calculate current availability from stats, respecting distributed allocation */
  calculateAvailability(): Availability {
    const { models, memory } = this.getStats();
    // Local stats already reflect per-instance limits (set via setRateLimits from allocation)
    const tokensPerMinute = getMinRemaining(models, (s) => s.tokensPerMinute?.remaining);
    const tokensPerDay = getMinRemaining(models, (s) => s.tokensPerDay?.remaining);
    const requestsPerMinute = getMinRemaining(models, (s) => s.requestsPerMinute?.remaining);
    const requestsPerDay = getMinRemaining(models, (s) => s.requestsPerDay?.remaining);
    const concurrentRequests = getMinRemaining(models, (s) => s.concurrency?.available);
    const memoryKB = memory?.availableKB ?? null;

    const partialAvailability = {
      tokensPerMinute,
      tokensPerDay,
      requestsPerMinute,
      requestsPerDay,
      concurrentRequests,
      memoryKB,
    };

    // Calculate slots with per-job-type memory constraint
    const { distributedAllocation, resourceEstimationsPerJob } = this;
    const slots = this.calculateSlotsWithMemoryConstraint(
      partialAvailability,
      distributedAllocation,
      resourceEstimationsPerJob,
      memoryKB
    );

    return { slots, ...partialAvailability };
  }

  /**
   * Calculate total slots applying memory constraint and per-model clamping to pools.
   * Memory is LOCAL - each instance applies its own memory limit.
   *
   * Pool-based calculation:
   *   1. Sum pool slots from distributed allocation (per-model)
   *   2. Calculate memory slots based on estimated memory per job
   *   3. Apply memory constraint (scale down proportionally if needed)
   *   4. Clamp each model's scaled slots using minCapacity/maxCapacity
   *   5. Return sum of clamped slots
   *
   * Note: Job type distribution is handled locally by JobTypeManager, not here.
   */
  private calculateSlotsWithMemoryConstraint(
    availability: Omit<Availability, 'slots'>,
    allocation: AllocationInfo | null,
    resourcesPerJob: ResourceEstimationsPerJob | undefined,
    totalMemoryKB: number | null
  ): number {
    // No distributed allocation - use legacy local calculation
    if (allocation === null) {
      return calculateSlots({ ...availability, slots: ZERO }, this.estimated);
    }

    const { modelCapacityBounds } = this;
    const { pools } = allocation;

    // Calculate memory slots per job type based on ratios and individual memory estimates
    let memorySlots = Number.POSITIVE_INFINITY;
    if (totalMemoryKB !== null && resourcesPerJob !== undefined) {
      memorySlots = this.calculatePerJobTypeMemorySlots(resourcesPerJob, totalMemoryKB);
    }

    // Apply memory constraint and per-model clamping to pools
    return applyMemoryConstraintAndClamping(pools, memorySlots, modelCapacityBounds);
  }

  /**
   * Calculate total memory slots by summing per-job-type memory slots.
   * Each job type gets: floor((totalMemory * ratio) / estimatedMemoryKB)
   * Uses initial ratios from config for stable reporting.
   */
  private calculatePerJobTypeMemorySlots(
    resourcesPerJob: ResourceEstimationsPerJob,
    totalMemoryKB: number
  ): number {
    const jobTypes = Object.entries(resourcesPerJob);
    if (jobTypes.length === ZERO) return Number.POSITIVE_INFINITY;

    // Calculate ratios (initial values or equal distribution)
    const ratios = this.calculateRatiosFromConfig(resourcesPerJob);

    let totalSlots = ZERO;
    let hasMemoryConstraint = false;

    for (const [jobType, config] of jobTypes) {
      const ratio = ratios.get(jobType) ?? (ONE / jobTypes.length);
      const memoryForJobType = totalMemoryKB * ratio;
      const estimatedMemoryKB = config?.estimatedUsedMemoryKB ?? ZERO;

      if (estimatedMemoryKB > ZERO) {
        totalSlots += Math.floor(memoryForJobType / estimatedMemoryKB);
        hasMemoryConstraint = true;
      }
    }

    return hasMemoryConstraint ? totalSlots : Number.POSITIVE_INFINITY;
  }

  /** Calculate ratios from resourceEstimationsPerJob config (initial values or equal distribution) */
  private calculateRatiosFromConfig(resourcesPerJob: ResourceEstimationsPerJob): Map<string, number> {
    const jobTypeIds = Object.keys(resourcesPerJob);
    const ratios = new Map<string, number>();

    let specifiedTotal = ZERO;
    const specifiedRatios = new Map<string, number>();

    for (const id of jobTypeIds) {
      const config = resourcesPerJob[id];
      if (config?.ratio?.initialValue !== undefined) {
        specifiedRatios.set(id, config.ratio.initialValue);
        specifiedTotal += config.ratio.initialValue;
      }
    }

    const remainingRatio = ONE - specifiedTotal;
    const unspecifiedCount = jobTypeIds.length - specifiedRatios.size;
    const evenShare = unspecifiedCount > ZERO ? remainingRatio / unspecifiedCount : ZERO;

    for (const id of jobTypeIds) {
      ratios.set(id, specifiedRatios.get(id) ?? evenShare);
    }

    return ratios;
  }

  /** Check for changes and emit callback if availability changed */
  checkAndEmit(
    hintReason: AvailabilityChangeReason,
    modelId: string,
    adjustment?: RelativeAvailabilityAdjustment
  ): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    const { previousAvailability } = this;

    if (hintReason === 'adjustment' && adjustment !== undefined) {
      this.previousAvailability = currentAvailability;
      this.callback(currentAvailability, 'adjustment', modelId, adjustment);
      return;
    }

    if (previousAvailability !== null && availabilityEquals(previousAvailability, currentAvailability)) {
      return;
    }

    const reason =
      previousAvailability === null ? hintReason : determineReason(previousAvailability, currentAvailability);
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, reason, modelId, undefined);
  }

  /** Emit callback for adjustment with proper tracking */
  emitAdjustment(adjustment: RelativeAvailabilityAdjustment, modelId: string): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, 'adjustment', modelId, adjustment);
  }

  /** Initialize with current availability (call after limiter is fully initialized) */
  initialize(): void {
    this.previousAvailability = this.calculateAvailability();
  }

  /** Get current availability without emitting */
  getCurrentAvailability(): Availability {
    return this.calculateAvailability();
  }
}
