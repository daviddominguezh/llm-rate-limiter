/**
 * Capacity invariant check for per-model-per-jobType slot allocation.
 *
 * Verifies that for each model, the sum of (slots × estimatedResource)
 * across all job types does not exceed the instance's allocated capacity.
 * Logs an error if the invariant is violated.
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type { JobTypeState } from '../jobTypeTypes.js';
import { calculateModelJobTypeSlots } from './jobTypeSlotCalculation.js';

const ZERO = 0;
const CONCURRENCY_PER_SLOT = 1;

/** A single resource dimension check result */
interface ResourceCheck {
  name: string;
  capacity: number;
  totalEstimatedUsage: number;
}

/** Add a check if the capacity is positive */
const addCheck = (checks: ResourceCheck[], name: string, capacity: number, totalUsage: number): void => {
  if (capacity > ZERO) {
    checks.push({ name, capacity, totalEstimatedUsage: totalUsage });
  }
};

/** Accumulate estimated resource usage across all job types for one model */
const accumulateUsage = (
  pool: ModelPoolAllocation,
  states: ReadonlyMap<string, JobTypeState>,
  minCapacity: number
): { totalTokens: number; totalRequests: number; totalSlots: number } => {
  let totalTokens = ZERO;
  let totalRequests = ZERO;
  let totalSlots = ZERO;
  for (const state of states.values()) {
    const { slots } = calculateModelJobTypeSlots(pool, state.currentRatio, state.resources, minCapacity);
    totalTokens += slots * (state.resources.estimatedUsedTokens ?? ZERO);
    totalRequests += slots * (state.resources.estimatedNumberOfRequests ?? ZERO);
    totalSlots += slots * CONCURRENCY_PER_SLOT;
  }
  return { totalTokens, totalRequests, totalSlots };
};

/** Build all resource dimension checks for a single model */
const buildChecksForModel = (
  pool: ModelPoolAllocation,
  states: ReadonlyMap<string, JobTypeState>,
  minCapacity: number
): ResourceCheck[] => {
  const { totalTokens, totalRequests, totalSlots } = accumulateUsage(pool, states, minCapacity);
  const checks: ResourceCheck[] = [];
  addCheck(checks, 'TPM', pool.tokensPerMinute, totalTokens);
  addCheck(checks, 'RPM', pool.requestsPerMinute, totalRequests);
  addCheck(checks, 'TPD', pool.tokensPerDay, totalTokens);
  addCheck(checks, 'RPD', pool.requestsPerDay, totalRequests);
  addCheck(checks, 'Concurrency', pool.totalSlots, totalSlots);
  return checks;
};

/** Parameters for the capacity invariant validation */
export interface ValidateCapacityParams {
  modelPools: ReadonlyMap<string, ModelPoolAllocation>;
  states: ReadonlyMap<string, JobTypeState>;
  minCapacity: number;
  log: (message: string, data?: Record<string, unknown>) => void;
}

/** Log violations for a single model's resource checks */
const logViolations = (
  modelId: string,
  checks: ResourceCheck[],
  log: (message: string, data?: Record<string, unknown>) => void
): void => {
  for (const check of checks) {
    if (check.totalEstimatedUsage > check.capacity) {
      log(`CAPACITY INVARIANT VIOLATION on ${modelId}`, {
        dimension: check.name,
        totalEstimatedUsage: check.totalEstimatedUsage,
        capacity: check.capacity,
        excess: check.totalEstimatedUsage - check.capacity,
      });
    }
  }
};

/** Validate that slot allocations do not exceed instance capacity */
export const validateCapacityInvariant = (params: ValidateCapacityParams): void => {
  const { modelPools, states, minCapacity, log } = params;
  for (const [modelId, pool] of modelPools) {
    const checks = buildChecksForModel(pool, states, minCapacity);
    logViolations(modelId, checks, log);
  }
};
