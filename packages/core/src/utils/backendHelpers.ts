/**
 * Backend helper functions for the LLM Rate Limiter.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { BackendConfig, BackendEstimatedResources } from '../multiModelTypes.js';

const ZERO = 0;

/** Get estimated resources for backend from resourcesPerJob config */
export const getEstimatedResourcesForBackend = (
  resourcesPerJob: ResourceEstimationsPerJob,
  jobType: string
): BackendEstimatedResources => {
  const resources = resourcesPerJob[jobType];
  return {
    requests: resources?.estimatedNumberOfRequests ?? ZERO,
    tokens: resources?.estimatedUsedTokens ?? ZERO,
  };
};

/** Backend operation context */
export interface BackendOperationContext {
  backend: BackendConfig | undefined;
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  instanceId: string;
  modelId: string;
  jobId: string;
  /** Job type for capacity allocation (required) */
  jobType: string;
}

/** Acquire backend slot */
export const acquireBackend = async (ctx: BackendOperationContext): Promise<boolean> => {
  const { backend, resourceEstimationsPerJob, instanceId, modelId, jobId, jobType } = ctx;
  if (backend === undefined) {
    return true;
  }
  return await backend.acquire({
    instanceId,
    modelId,
    jobId,
    jobType,
    estimated: getEstimatedResourcesForBackend(resourceEstimationsPerJob, jobType),
  });
};

/** Release backend slot */
export const releaseBackend = (
  ctx: BackendOperationContext,
  actual: { requests: number; tokens: number }
): void => {
  const { backend, resourceEstimationsPerJob, instanceId, modelId, jobId, jobType } = ctx;
  if (backend === undefined) {
    return;
  }
  backend
    .release({
      instanceId,
      modelId,
      jobId,
      jobType,
      estimated: getEstimatedResourcesForBackend(resourceEstimationsPerJob, jobType),
      actual,
    })
    .catch(() => {
      /* User handles errors */
    });
};
