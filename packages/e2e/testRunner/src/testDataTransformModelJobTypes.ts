/**
 * Per-model-per-jobtype enrichment for compact snapshots.
 *
 * Computes slots and inFlight for each (model, jobType) pair using:
 * - allocation.pools[model] (per-model pool with TPM/RPM/TPD/RPD)
 * - jobTypes[type].currentRatio and .resources (global ratios + per-job estimates)
 * - activeJobs filtered by (currentModelId, jobType)
 *
 * Uses the same slot formula as the core JTM:
 *   slots = min(floor(pool.TPM * ratio / estTokens), floor(pool.RPM * ratio / estReqs), ...)
 *   fallback = floor(pool.totalSlots * ratio) for concurrency-only models
 */
import { calculateModelJobTypeSlots } from '@llm-rate-limiter/core';
import type { ActiveJobInfo, ModelPoolAllocation } from '@llm-rate-limiter/core';
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

/** Build per-jobtype state for a single model using correct slot formula */
const buildModelJobTypes = (
  pool: ModelPoolAllocation,
  jobTypeInfos: Record<string, JobTypeInfo>,
  modelInFlight: Map<string, number> | undefined
): Record<string, CompactModelJobTypeState> => {
  const result: Record<string, CompactModelJobTypeState> = {};
  for (const [jtId, info] of Object.entries(jobTypeInfos)) {
    const { slots } = calculateModelJobTypeSlots(pool, info.ratio, info.resources, MIN_CAPACITY);
    const inFlight = modelInFlight?.get(jtId) ?? ZERO;
    result[jtId] = { slots, inFlight };
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
const enrichModel = (
  modelState: CompactModelState,
  pool: ModelPoolAllocation,
  jobTypeInfos: Record<string, JobTypeInfo>,
  modelInFlight: Map<string, number> | undefined
): CompactModelState => {
  const modelJobTypes = buildModelJobTypes(pool, jobTypeInfos, modelInFlight);
  return { ...modelState, jobTypes: modelJobTypes };
};

/** Enrich compact models with per-jobtype slots and inFlight, returns new record */
export const enrichModelsWithJobTypes = (
  models: Record<string, CompactModelState>,
  state: InstanceState
): Record<string, CompactModelState> => {
  const { allocation } = state;
  if (allocation === null) {
    return models;
  }
  const jobTypeInfos = getJobTypeInfoMap(state);
  const inFlightByModel = buildInFlightByModel(state.activeJobs);
  const enriched: Record<string, CompactModelState> = {};
  const { pools } = allocation;

  for (const [modelId, modelState] of Object.entries(models)) {
    const { [modelId]: pool } = pools;
    if (pool === undefined) {
      enriched[modelId] = modelState;
      continue;
    }
    enriched[modelId] = enrichModel(modelState, pool, jobTypeInfos, inFlightByModel.get(modelId));
  }

  for (const [modelId, pool] of Object.entries(pools)) {
    if (enriched[modelId] !== undefined) {
      continue;
    }
    const base = buildEmptyModelState();
    enriched[modelId] = enrichModel(base, pool, jobTypeInfos, inFlightByModel.get(modelId));
  }

  return enriched;
};
