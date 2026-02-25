/**
 * Per-model-per-jobtype enrichment for compact snapshots.
 *
 * Computes slots and inFlight for each (model, jobType) pair using:
 * - allocation.pools[model] (per-model pool with TPM/RPM/TPD/RPD)
 * - jobTypes[type].currentRatio and .resources (global ratios + per-job estimates)
 * - JTM-reported modelJobTypes for effective inFlight (window counter for rate-based models)
 * - activeJobs as fallback when JTM data unavailable
 *
 * Uses the same slot formula as the core JTM:
 *   slots = min(floor(pool.TPM * ratio / estTokens), floor(pool.RPM * ratio / estReqs), ...)
 *   totalSlots uses the same formula but with the unreduced (base) pool from first snapshot
 */
import { calculateModelJobTypeSlots } from '@llm-rate-limiter/core';
import type { ActiveJobInfo, ModelJobTypeInfo, ModelPoolAllocation } from '@llm-rate-limiter/core';
import type { CompactModelJobTypeState, CompactModelState } from '@llm-rate-limiter/e2e-test-results';

import type { InstanceState } from './stateAggregator.js';

const ZERO = 0;
const ONE = 1;
const MIN_CAPACITY = 0;

/** Per-job-type info extracted from stats */
interface JobTypeInfo {
  ratio: number;
  resources: { estimatedUsedTokens?: number; estimatedNumberOfRequests?: number };
}

/** InFlight counts keyed by modelId → jobType → count */
type InFlightByModel = Map<string, Map<string, number>>;

/** JTM-reported per-model-per-jobType info */
type JtmModelJobTypes = Record<string, Record<string, ModelJobTypeInfo>>;

/** Pools keyed by model ID */
type PoolsByModel = Record<string, ModelPoolAllocation>;

/** Shared enrichment data that stays constant across all models */
interface SharedEnrichData {
  jobTypeInfos: Record<string, JobTypeInfo>;
  inFlightByModel: InFlightByModel;
  jtmModelJobTypes: JtmModelJobTypes | undefined;
  basePools: PoolsByModel | undefined;
}

/** Extract job type info (ratios + resources) from stats */
const getJobTypeInfoMap = (state: InstanceState): Record<string, JobTypeInfo> => {
  const result: Record<string, JobTypeInfo> = {};
  const {
    stats: { jobTypes },
  } = state;
  if (jobTypes === undefined) {
    return result;
  }
  for (const [jtId, jtState] of Object.entries(jobTypes.jobTypes)) {
    const { currentRatio, resources } = jtState;
    result[jtId] = { ratio: currentRatio, resources };
  }
  return result;
};

/** Check if job is actively processing (consuming a slot) */
const isProcessing = (job: ActiveJobInfo): boolean => job.status === 'processing';

/** Count processing jobs grouped by (currentModelId, jobType) */
const buildInFlightByModel = (activeJobs: ActiveJobInfo[]): InFlightByModel => {
  const counts: InFlightByModel = new Map();
  for (const job of activeJobs) {
    if (job.currentModelId === null || !isProcessing(job)) {
      continue;
    }
    let modelMap = counts.get(job.currentModelId);
    if (modelMap === undefined) {
      modelMap = new Map();
      counts.set(job.currentModelId, modelMap);
    }
    const current = modelMap.get(job.jobType) ?? ZERO;
    modelMap.set(job.jobType, current + ONE);
  }
  return counts;
};

/** Get effective inFlight: prefer JTM-reported value, fall back to activeJobs count */
const getEffectiveInFlight = (
  jtId: string,
  jtmInfo: Record<string, ModelJobTypeInfo> | undefined,
  modelInFlight: Map<string, number> | undefined
): number => {
  const entry = jtmInfo?.[jtId];
  if (entry !== undefined) {
    return entry.inFlight;
  }
  return modelInFlight?.get(jtId) ?? ZERO;
};

/** Context for enriching a single model with job type info */
interface ModelEnrichContext {
  pool: ModelPoolAllocation;
  /** Unreduced pool for computing totalSlots (full allocation before dynamic reductions) */
  basePool: ModelPoolAllocation;
  /** Pool with totalSlots replaced by acquirableSlots for computing acquirable-based capacity */
  acquirablePool: ModelPoolAllocation;
  jobTypeInfos: Record<string, JobTypeInfo>;
  modelInFlight: Map<string, number> | undefined;
  jtmInfo: Record<string, ModelJobTypeInfo> | undefined;
}

/** Build per-jobtype state for a single model using correct slot formula */
const buildModelJobTypes = (context: ModelEnrichContext): Record<string, CompactModelJobTypeState> => {
  const result: Record<string, CompactModelJobTypeState> = {};
  for (const [jtId, info] of Object.entries(context.jobTypeInfos)) {
    const { slots } = calculateModelJobTypeSlots(context.pool, info.ratio, info.resources, MIN_CAPACITY);
    const { slots: totalSlots } = calculateModelJobTypeSlots(
      context.basePool,
      info.ratio,
      info.resources,
      MIN_CAPACITY
    );
    const { slots: acquirableSlots } = calculateModelJobTypeSlots(
      context.acquirablePool,
      info.ratio,
      info.resources,
      MIN_CAPACITY
    );
    const inFlight = getEffectiveInFlight(jtId, context.jtmInfo, context.modelInFlight);
    result[jtId] = { slots, totalSlots, acquirableSlots, inFlight };
  }
  return result;
};

/** Create a zero-activity base model state */
const buildEmptyModelState = (): CompactModelState => ({
  rpm: ZERO,
  rpmRemaining: ZERO,
  tpm: ZERO,
  tpmRemaining: ZERO,
});

/** Enrich existing model with jobTypes breakdown */
const enrichModel = (modelState: CompactModelState, context: ModelEnrichContext): CompactModelState => ({
  ...modelState,
  jobTypes: buildModelJobTypes(context),
});

/** Extract JTM-reported per-model-per-jobType info from stats (if available) */
const getJtmModelJobTypes = (state: InstanceState): JtmModelJobTypes | undefined =>
  state.stats.jobTypes?.modelJobTypes;

/** Create pool with totalSlots replaced by acquirableSlots for dynamic capacity */
const toAcquirablePool = (pool: ModelPoolAllocation): ModelPoolAllocation => ({
  ...pool,
  totalSlots: pool.acquirableSlots ?? pool.totalSlots,
});

/** Build per-model enrichment context from shared data */
const buildEnrichContext = (
  pool: ModelPoolAllocation,
  modelId: string,
  shared: SharedEnrichData
): ModelEnrichContext => ({
  pool,
  basePool: shared.basePools?.[modelId] ?? pool,
  acquirablePool: toAcquirablePool(pool),
  jobTypeInfos: shared.jobTypeInfos,
  modelInFlight: shared.inFlightByModel.get(modelId),
  jtmInfo: shared.jtmModelJobTypes?.[modelId],
});

/** Enrich compact models with per-jobtype slots and inFlight, returns new record */
export const enrichModelsWithJobTypes = (
  models: Record<string, CompactModelState>,
  state: InstanceState,
  basePools: PoolsByModel | undefined
): Record<string, CompactModelState> => {
  const { allocation } = state;
  if (allocation === null) {
    return models;
  }
  const shared: SharedEnrichData = {
    jobTypeInfos: getJobTypeInfoMap(state),
    inFlightByModel: buildInFlightByModel(state.activeJobs),
    jtmModelJobTypes: getJtmModelJobTypes(state),
    basePools,
  };
  const enriched: Record<string, CompactModelState> = {};
  const { pools } = allocation;

  for (const [modelId, modelState] of Object.entries(models)) {
    const { [modelId]: pool } = pools;
    if (pool === undefined) {
      enriched[modelId] = modelState;
      continue;
    }
    enriched[modelId] = enrichModel(modelState, buildEnrichContext(pool, modelId, shared));
  }

  for (const [modelId, pool] of Object.entries(pools)) {
    if (enriched[modelId] !== undefined) {
      continue;
    }
    const base = buildEmptyModelState();
    enriched[modelId] = enrichModel(base, buildEnrichContext(pool, modelId, shared));
  }

  return enriched;
};
