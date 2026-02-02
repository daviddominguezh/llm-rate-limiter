/**
 * Backend helper functions for the LLM Rate Limiter.
 */
import type {
  BackendConfig,
  BackendEstimatedResources,
  DistributedBackendConfig,
  ModelRateLimitConfig,
} from '../multiModelTypes.js';

const ZERO = 0;

/** Check if the backend is V2 (has register method) */
export const isV2Backend = (
  backend: BackendConfig | DistributedBackendConfig
): backend is DistributedBackendConfig => 'register' in backend && typeof backend.register === 'function';

/** Get estimated resources for backend from model config */
export const getEstimatedResourcesForBackend = (
  models: Record<string, ModelRateLimitConfig>,
  modelId: string
): BackendEstimatedResources => {
  const resources = models[modelId]?.resourcesPerEvent;
  return {
    requests: resources?.estimatedNumberOfRequests ?? ZERO,
    tokens: resources?.estimatedUsedTokens ?? ZERO,
  };
};

/** Backend operation context */
export interface BackendOperationContext {
  backend: BackendConfig | DistributedBackendConfig | undefined;
  models: Record<string, ModelRateLimitConfig>;
  instanceId: string;
  modelId: string;
  jobId: string;
  /** Job type for capacity allocation (undefined if not using job types) */
  jobType?: string;
}

/** Acquire backend slot */
export const acquireBackend = async (ctx: BackendOperationContext): Promise<boolean> => {
  const { backend, models, instanceId, modelId, jobId, jobType } = ctx;
  if (backend === undefined) {
    return true;
  }
  const baseContext = {
    modelId,
    jobId,
    jobType,
    estimated: getEstimatedResourcesForBackend(models, modelId),
  };
  if (isV2Backend(backend)) {
    return await backend.acquire({ ...baseContext, instanceId });
  }
  return await backend.acquire(baseContext);
};

/** Release backend slot */
export const releaseBackend = (
  ctx: BackendOperationContext,
  actual: { requests: number; tokens: number }
): void => {
  const { backend, models, instanceId, modelId, jobId, jobType } = ctx;
  if (backend === undefined) {
    return;
  }
  const baseContext = {
    modelId,
    jobId,
    jobType,
    estimated: getEstimatedResourcesForBackend(models, modelId),
    actual,
  };
  if (isV2Backend(backend)) {
    backend.release({ ...baseContext, instanceId }).catch(() => {
      /* User handles errors */
    });
    return;
  }
  backend.release(baseContext).catch(() => {
    /* User handles errors */
  });
};
