/**
 * Tracks availability changes and emits callbacks when slots change.
 */
import type {
  Availability,
  AvailabilityChangeReason,
  LLMRateLimiterStats,
  OnAvailableSlotsChange,
  RelativeAvailabilityAdjustment,
} from '../multiModelTypes.js';
import type { InternalLimiterStats } from '../types.js';

const ZERO = 0;

/** Estimated resources per job, used to calculate available slots */
export interface EstimatedResources {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  estimatedUsedMemoryKB: number;
}

/** Configuration for the availability tracker */
export interface AvailabilityTrackerConfig {
  callback: OnAvailableSlotsChange | undefined;
  getStats: () => LLMRateLimiterStats;
  estimatedResources: EstimatedResources;
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

  constructor(config: AvailabilityTrackerConfig) {
    const { callback, getStats, estimatedResources } = config;
    this.callback = callback;
    this.getStats = getStats;
    this.estimated = estimatedResources;
  }

  /** Calculate current availability from stats */
  calculateAvailability(): Availability {
    const { models, memory } = this.getStats();
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
    const slots = calculateSlots({ ...partialAvailability, slots: ZERO }, this.estimated);
    return { slots, ...partialAvailability };
  }

  /** Check for changes and emit callback if availability changed */
  checkAndEmit(hintReason: AvailabilityChangeReason, adjustment?: RelativeAvailabilityAdjustment): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    const { previousAvailability } = this;

    if (hintReason === 'adjustment' && adjustment !== undefined) {
      this.previousAvailability = currentAvailability;
      this.callback(currentAvailability, 'adjustment', adjustment);
      return;
    }

    if (previousAvailability !== null && availabilityEquals(previousAvailability, currentAvailability)) {
      return;
    }

    const reason =
      previousAvailability === null
        ? hintReason
        : determineReason(previousAvailability, currentAvailability);
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, reason, undefined);
  }

  /** Emit callback for adjustment with proper tracking */
  emitAdjustment(adjustment: RelativeAvailabilityAdjustment): void {
    if (this.callback === undefined) return;
    const currentAvailability = this.calculateAvailability();
    this.previousAvailability = currentAvailability;
    this.callback(currentAvailability, 'adjustment', adjustment);
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
