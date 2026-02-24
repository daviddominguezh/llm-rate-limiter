/**
 * Per-model state tracking for the JobTypeManager.
 *
 * Tracks per-model pool allocations, per-(model, jobType) inFlight counts,
 * and window-based counters for rate-limited dimensions (TPM/RPM/TPD/RPD).
 * Delegates slot computation to jobTypeSlotCalculation.
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type { JobTypeResources, ModelJobTypeInfo } from '../jobTypeTypes.js';
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
  /** Release a slot for a (model, jobType) pair. Always decrements window counter. */
  release: (modelId: string, jobTypeId: string, hadRefund?: boolean) => void;
  /** Get effective inFlight: window counter for rate-based, concurrent count for concurrency-based */
  getInFlight: (params: HasCapacityParams) => number;
  /** Get actual concurrent inFlight count (not window-based) for ratio adjustment */
  getConcurrentInFlight: (modelId: string, jobTypeId: string) => number;
  /** Get allocated slots for a (model, jobType) pair */
  getAllocated: (params: HasCapacityParams) => number;
  /** Get info for all (model, jobType) pairs */
  getAllModelJobTypeInfo: (
    states: ReadonlyMap<string, { currentRatio: number; resources: JobTypeResources }>,
    minCapacity: number
  ) => Record<string, Record<string, ModelJobTypeInfo>>;
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

/** Bundled counter state shared across tracker methods */
interface TrackerCounters {
  windowCounters: Map<string, WindowEntry>;
  modelInFlight: Map<string, Map<string, number>>;
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

/** Decrement the window counter if still in the same window (mirrors internal limiter refund) */
const decrementWindowCounter = (
  counters: Map<string, WindowEntry>,
  modelId: string,
  jobTypeId: string
): void => {
  const entry = counters.get(windowKey(modelId, jobTypeId));
  if (entry === undefined) return;
  if (entry.windowId !== currentWindowId(entry.windowMs)) return;
  if (entry.count > ZERO) {
    entry.count -= ONE;
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
// Effective inFlight helpers
// =============================================================================

/** Compute effective inFlight for a (model, jobType) pair based on model type */
const computeEffectiveInFlight = (
  result: SlotCalculationResult,
  counters: TrackerCounters,
  modelId: string,
  jobTypeId: string
): number => {
  if (result.windowMs > ZERO) {
    return getWindowCount(counters.windowCounters, modelId, jobTypeId, result.windowMs);
  }
  return counters.modelInFlight.get(modelId)?.get(jobTypeId) ?? ZERO;
};

/** Resolve slot state (allocated + effective inFlight) from capacity params */
const resolveSlotState = (
  modelPools: Map<string, ModelPoolAllocation>,
  counters: TrackerCounters,
  params: HasCapacityParams
): { slots: number; inFlight: number } => {
  const pool = modelPools.get(params.modelId);
  const result = getSlotResult(pool, params.ratio, params.resources, params.minCapacity);
  const inFlight = computeEffectiveInFlight(result, counters, params.modelId, params.jobTypeId);
  return { slots: result.slots, inFlight };
};

/** Context for building per-model job type info */
interface ModelInfoContext {
  pool: ModelPoolAllocation;
  counters: TrackerCounters;
  modelId: string;
  minCapacity: number;
}

/** Build info for all job types on a single model */
const buildSingleModelInfo = (
  context: ModelInfoContext,
  states: ReadonlyMap<string, { currentRatio: number; resources: JobTypeResources }>
): Record<string, ModelJobTypeInfo> => {
  const modelResult: Record<string, ModelJobTypeInfo> = {};
  for (const [jobTypeId, state] of states) {
    const slotResult = calculateModelJobTypeSlots(
      context.pool,
      state.currentRatio,
      state.resources,
      context.minCapacity
    );
    const inFlight = context.counters.modelInFlight.get(context.modelId)?.get(jobTypeId) ?? ZERO;
    modelResult[jobTypeId] = { allocated: slotResult.slots, inFlight };
  }
  return modelResult;
};

// =============================================================================
// Tracker factory helpers
// =============================================================================

/** Release inFlight count for a (model, jobType) pair */
const releaseInFlight = (
  modelInFlight: Map<string, Map<string, number>>,
  modelId: string,
  jobTypeId: string
): void => {
  const inner = modelInFlight.get(modelId);
  if (inner === undefined) return;
  const current = inner.get(jobTypeId) ?? ZERO;
  if (current > ZERO) {
    inner.set(jobTypeId, current - ONE);
  }
};

/** Create getAllModelJobTypeInfo closure */
const createGetAllInfo =
  (
    modelPools: Map<string, ModelPoolAllocation>,
    counters: TrackerCounters
  ): ModelJobTypeTracker['getAllModelJobTypeInfo'] =>
  (states, minCapacity) => {
    const result: Record<string, Record<string, ModelJobTypeInfo>> = {};
    for (const [modelId, pool] of modelPools) {
      const context: ModelInfoContext = { pool, counters, modelId, minCapacity };
      result[modelId] = buildSingleModelInfo(context, states);
    }
    return result;
  };

// =============================================================================
// Tracker factory
// =============================================================================

/** Create a ModelJobTypeTracker instance */
export const createModelJobTypeTracker = (): ModelJobTypeTracker => {
  const modelPools = new Map<string, ModelPoolAllocation>();
  const counters: TrackerCounters = {
    modelInFlight: new Map(),
    windowCounters: new Map(),
  };

  return {
    setModelPool: (modelId, pool) => {
      modelPools.set(modelId, pool);
    },
    getModelPool: (modelId) => modelPools.get(modelId),
    hasCapacity: (params) => {
      const state = resolveSlotState(modelPools, counters, params);
      return state.inFlight < state.slots;
    },
    acquire(modelId, jobTypeId, windowMs) {
      const inner = getOrCreateModelMap(counters.modelInFlight, modelId);
      const current = inner.get(jobTypeId) ?? ZERO;
      inner.set(jobTypeId, current + ONE);
      if (windowMs > ZERO) {
        incrementWindowCounter(counters.windowCounters, modelId, jobTypeId, windowMs);
      }
    },
    release: (modelId: string, jobTypeId: string, _hadRefund?: boolean) => {
      releaseInFlight(counters.modelInFlight, modelId, jobTypeId);
      decrementWindowCounter(counters.windowCounters, modelId, jobTypeId);
    },
    getInFlight: (params) => resolveSlotState(modelPools, counters, params).inFlight,
    getConcurrentInFlight: (modelId, jobTypeId) =>
      counters.modelInFlight.get(modelId)?.get(jobTypeId) ?? ZERO,
    getAllocated: (params) =>
      getSlotResult(modelPools.get(params.modelId), params.ratio, params.resources, params.minCapacity).slots,
    getAllModelJobTypeInfo: createGetAllInfo(modelPools, counters),
    hasModelPools: () => modelPools.size > ZERO,
    getModelPools: () => modelPools as ReadonlyMap<string, ModelPoolAllocation>,
  };
};
