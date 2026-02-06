/**
 * Per-model state tracking for the JobTypeManager.
 *
 * Tracks per-model pool allocations, per-(model, jobType) inFlight counts,
 * and window-based counters for rate-limited dimensions (TPM/RPM/TPD/RPD).
 * Delegates slot computation to jobTypeSlotCalculation.
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type { JobTypeResources } from '../jobTypeTypes.js';
import type { SlotCalculationResult } from './jobTypeSlotCalculation.js';
import { calculateModelJobTypeSlots } from './jobTypeSlotCalculation.js';

const ZERO = 0;
const ONE = 1;

/** Parameters for checking per-model capacity */
export interface HasCapacityParams {
  modelId: string;
  jobTypeId: string;
  ratio: number;
  resources: JobTypeResources;
  minCapacity: number;
}

/** Per-model state tracker interface */
export interface ModelJobTypeTracker {
  /** Set the pool allocation for a model */
  setModelPool: (modelId: string, pool: ModelPoolAllocation) => void;
  /** Get the pool allocation for a model */
  getModelPool: (modelId: string) => ModelPoolAllocation | undefined;
  /** Check if a (model, jobType) pair has available capacity */
  hasCapacity: (params: HasCapacityParams) => boolean;
  /** Acquire a slot for a (model, jobType) pair. windowMs > 0 means rate-based tracking. */
  acquire: (modelId: string, jobTypeId: string, windowMs: number) => void;
  /** Release a slot for a (model, jobType) pair (decrements inFlight only, not window counter) */
  release: (modelId: string, jobTypeId: string) => void;
  /** Get inFlight count for a (model, jobType) pair */
  getInFlight: (modelId: string, jobTypeId: string) => number;
  /** Get allocated slots for a (model, jobType) pair */
  getAllocated: (params: HasCapacityParams) => number;
  /** Check if any model pools have been set (distributed mode active) */
  hasModelPools: () => boolean;
  /** Get all model pools for invariant checking */
  getModelPools: () => ReadonlyMap<string, ModelPoolAllocation>;
}

// =============================================================================
// InFlight helpers
// =============================================================================

/** Get or create the inner map for a model */
const getOrCreateModelMap = (
  outerMap: Map<string, Map<string, number>>,
  modelId: string
): Map<string, number> => {
  let inner = outerMap.get(modelId);
  if (inner === undefined) {
    inner = new Map();
    outerMap.set(modelId, inner);
  }
  return inner;
};

// =============================================================================
// Window counter helpers (lazy-reset, same pattern as TimeWindowCounter)
// =============================================================================

/** A window-based counter entry for a (model, jobType) pair */
interface WindowEntry {
  windowId: number;
  count: number;
  windowMs: number;
}

/** Composite key for window counter map */
const windowKey = (modelId: string, jobTypeId: string): string => `${modelId}:${jobTypeId}`;

/** Current window ID for a given window duration */
const currentWindowId = (windowMs: number): number => Math.floor(Date.now() / windowMs);

/** Get the window-based acquired count (lazy reset if window changed) */
const getWindowCount = (
  counters: Map<string, WindowEntry>,
  modelId: string,
  jobTypeId: string,
  windowMs: number
): number => {
  const entry = counters.get(windowKey(modelId, jobTypeId));
  if (entry === undefined) return ZERO;
  if (entry.windowId !== currentWindowId(windowMs)) return ZERO;
  return entry.count;
};

/** Increment the window counter (create or lazy-reset as needed) */
const incrementWindowCounter = (
  counters: Map<string, WindowEntry>,
  modelId: string,
  jobTypeId: string,
  windowMs: number
): void => {
  const key = windowKey(modelId, jobTypeId);
  const nowWindowId = currentWindowId(windowMs);
  const entry = counters.get(key);
  if (entry?.windowId === nowWindowId) {
    entry.count += ONE;
  } else {
    counters.set(key, { windowId: nowWindowId, count: ONE, windowMs });
  }
};

// =============================================================================
// Slot calculation wrapper
// =============================================================================

/** Get slot calculation result, returning zero slots if pool is undefined */
const getSlotResult = (
  pool: ModelPoolAllocation | undefined,
  ratio: number,
  resources: JobTypeResources,
  minCapacity: number
): SlotCalculationResult => {
  if (pool === undefined) {
    return { slots: ZERO, windowMs: ZERO };
  }
  return calculateModelJobTypeSlots(pool, ratio, resources, minCapacity);
};

// =============================================================================
// Tracker factory
// =============================================================================

/** Create release closure for inFlight tracking */
const createRelease =
  (modelInFlight: Map<string, Map<string, number>>): ((modelId: string, jobTypeId: string) => void) =>
  (modelId: string, jobTypeId: string): void => {
    const inner = modelInFlight.get(modelId);
    if (inner === undefined) return;
    const current = inner.get(jobTypeId) ?? ZERO;
    if (current > ZERO) {
      inner.set(jobTypeId, current - ONE);
    }
  };

/** Create a ModelJobTypeTracker instance */
export const createModelJobTypeTracker = (): ModelJobTypeTracker => {
  const modelPools = new Map<string, ModelPoolAllocation>();
  const modelInFlight = new Map<string, Map<string, number>>();
  const windowCounters = new Map<string, WindowEntry>();
  const releaseFn = createRelease(modelInFlight);

  return {
    setModelPool: (modelId, pool) => {
      modelPools.set(modelId, pool);
    },
    getModelPool: (modelId) => modelPools.get(modelId),
    hasCapacity(params: HasCapacityParams): boolean {
      const { modelId, jobTypeId, ratio, resources, minCapacity } = params;
      const pool = modelPools.get(modelId);
      const result = getSlotResult(pool, ratio, resources, minCapacity);
      if (result.windowMs > ZERO) {
        return getWindowCount(windowCounters, modelId, jobTypeId, result.windowMs) < result.slots;
      }
      const inFlight = modelInFlight.get(modelId)?.get(jobTypeId) ?? ZERO;
      return inFlight < result.slots;
    },
    acquire(modelId: string, jobTypeId: string, windowMs: number): void {
      const inner = getOrCreateModelMap(modelInFlight, modelId);
      const current = inner.get(jobTypeId) ?? ZERO;
      inner.set(jobTypeId, current + ONE);
      if (windowMs > ZERO) {
        incrementWindowCounter(windowCounters, modelId, jobTypeId, windowMs);
      }
    },
    release: releaseFn,
    getInFlight: (modelId, jobTypeId) => modelInFlight.get(modelId)?.get(jobTypeId) ?? ZERO,
    getAllocated: (params) =>
      getSlotResult(modelPools.get(params.modelId), params.ratio, params.resources, params.minCapacity).slots,
    hasModelPools: () => modelPools.size > ZERO,
    getModelPools: () => modelPools as ReadonlyMap<string, ModelPoolAllocation>,
  };
};
