/**
 * Setup and weight computation for structured capacity data.
 *
 * Computes per-model job type weights based on the most limiting constraint
 * (TPM, RPM, or concurrency). Weights reflect resource cost and sum to 1
 * per model.
 */
import type { JobTypeResourceEstimate, ModelCapacity } from '@llm-rate-limiter/e2e-test-results';

// =============================================================================
// Public types
// =============================================================================

export interface ModelSetup {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

export interface JobTypeEstimates {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
}

export interface JobTypeSetup {
  estimates: JobTypeEstimates;
  weight: number;
}

export interface CapacitySetup {
  /** Map of instance URL to instance ID */
  instances: Record<string, string>;
  models: Record<string, ModelSetup>;
  jobTypes: Record<string, JobTypeSetup>;
}

/** Per-model weights: weights[modelId][jobTypeId] = weight */
export type ModelWeights = Record<string, Record<string, number>>;

// =============================================================================
// Weight computation
// =============================================================================

/** Compute the bottleneck fraction for one (model, jobType) pair */
function bottleneckFraction(model: ModelCapacity, jt: JobTypeResourceEstimate): number {
  const fractions: number[] = [];

  if (model.tokensPerMinute > 0) {
    fractions.push(jt.estimatedUsedTokens / model.tokensPerMinute);
  }
  if (model.requestsPerMinute > 0) {
    fractions.push(jt.estimatedNumberOfRequests / model.requestsPerMinute);
  }
  if (model.totalSlots > 0) {
    fractions.push(1 / model.totalSlots);
  }

  return Math.max(...fractions, 0);
}

/** Compute per-model weights: for each model, normalize job type costs to sum to 1 */
export function computeModelWeights(
  modelCapacities: Record<string, ModelCapacity>,
  jobTypeResources: Record<string, JobTypeResourceEstimate>
): ModelWeights {
  const weights: ModelWeights = {};

  for (const [modelId, model] of Object.entries(modelCapacities)) {
    const costs: Record<string, number> = {};
    let totalCost = 0;

    for (const [jtId, jt] of Object.entries(jobTypeResources)) {
      const cost = bottleneckFraction(model, jt);
      costs[jtId] = cost;
      totalCost += cost;
    }

    weights[modelId] = {};
    for (const [jtId, cost] of Object.entries(costs)) {
      weights[modelId][jtId] = totalCost > 0 ? cost / totalCost : 0;
    }
  }

  return weights;
}

/** Average weights across all models for a single representative weight per job type */
function averageWeights(modelWeights: ModelWeights, jobTypeIds: string[]): Record<string, number> {
  const sums: Record<string, number> = {};
  const models = Object.values(modelWeights);
  const modelCount = models.length;

  for (const jtId of jobTypeIds) {
    sums[jtId] = 0;
  }

  for (const perJt of models) {
    for (const [jtId, w] of Object.entries(perJt)) {
      sums[jtId] = (sums[jtId] ?? 0) + w;
    }
  }

  const averaged: Record<string, number> = {};
  for (const jtId of jobTypeIds) {
    averaged[jtId] = modelCount > 0 ? (sums[jtId] ?? 0) / modelCount : 0;
  }

  return averaged;
}

// =============================================================================
// Setup builder
// =============================================================================

/** Build the complete CapacitySetup from test metadata */
export function buildCapacitySetup(
  instances: Record<string, string>,
  modelCapacities: Record<string, ModelCapacity> | undefined,
  jobTypeResources: Record<string, JobTypeResourceEstimate> | undefined
): { setup: CapacitySetup; modelWeights: ModelWeights } {
  const models: Record<string, ModelSetup> = {};
  const jobTypes: Record<string, JobTypeSetup> = {};
  const safeModels = modelCapacities ?? {};
  const safeJobTypes = jobTypeResources ?? {};

  for (const [modelId, cap] of Object.entries(safeModels)) {
    models[modelId] = {
      totalSlots: cap.totalSlots,
      tokensPerMinute: cap.tokensPerMinute,
      requestsPerMinute: cap.requestsPerMinute,
      tokensPerDay: cap.tokensPerDay,
      requestsPerDay: cap.requestsPerDay,
    };
  }

  const modelWeights = computeModelWeights(safeModels, safeJobTypes);
  const avgWeights = averageWeights(modelWeights, Object.keys(safeJobTypes));

  for (const [jtId, res] of Object.entries(safeJobTypes)) {
    jobTypes[jtId] = {
      estimates: {
        estimatedUsedTokens: res.estimatedUsedTokens,
        estimatedNumberOfRequests: res.estimatedNumberOfRequests,
      },
      weight: avgWeights[jtId] ?? 0,
    };
  }

  return { setup: { instances, models, jobTypes }, modelWeights };
}
