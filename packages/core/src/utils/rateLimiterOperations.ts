/**
 * Helper operations for the rate limiter.
 */
import type { BackendFactoryInstance, DistributedBackendFactory } from '../backendFactoryTypes.js';
import { isDistributedBackendFactory } from '../backendFactoryTypes.js';
import type { JobTypeStats, RatioAdjustmentConfig, ResourcesPerJob } from '../jobTypeTypes.js';
import type {
  AllocationInfo,
  BackendConfig,
  DistributedBackendConfig,
  LLMRateLimiterStats,
  ModelsConfig,
  Unsubscribe,
} from '../multiModelTypes.js';
import type { InternalLimiterInstance, InternalLimiterStats, LogFn } from '../types.js';
import type { AvailabilityTracker } from './availabilityTracker.js';
import { type BackendOperationContext, isV2Backend } from './backendHelpers.js';
import { type JobTypeManager, createJobTypeManager } from './jobTypeManager.js';
import type { MemoryManagerInstance } from './memoryManager.js';

/**
 * Build stats for all model limiters.
 */
export const buildCombinedStats = (
  modelLimiters: Map<string, InternalLimiterInstance>,
  memoryManager: MemoryManagerInstance | null,
  jobTypeManager: JobTypeManager | null
): LLMRateLimiterStats => {
  const models: Record<string, InternalLimiterStats> = {};
  for (const [modelId, limiter] of modelLimiters) {
    models[modelId] = limiter.getStats();
  }
  return {
    models,
    memory: memoryManager?.getStats(),
    jobTypes: jobTypeManager?.getStats(),
  };
};

/**
 * Check if a job type has capacity.
 * Returns true if no job type manager (backward compatible).
 */
export const checkJobTypeCapacity = (jobTypeManager: JobTypeManager | null, jobType: string): boolean => {
  if (jobTypeManager === null) {
    return true;
  }
  return jobTypeManager.hasCapacity(jobType);
};

/**
 * Get job type stats if manager exists.
 */
export const getJobTypeStatsFromManager = (jobTypeManager: JobTypeManager | null): JobTypeStats | undefined =>
  jobTypeManager?.getStats();

/**
 * Get model stats with optional memory info.
 */
export const getModelStatsWithMemory = (
  limiter: InternalLimiterInstance,
  memoryManager: MemoryManagerInstance | null
): InternalLimiterStats => {
  const mem = memoryManager?.getStats();
  const stats = limiter.getStats();
  return mem === undefined ? stats : { ...stats, memory: mem };
};

/**
 * Stop all resources.
 */
export const stopAllResources = (
  modelLimiters: Map<string, InternalLimiterInstance>,
  memoryManager: MemoryManagerInstance | null,
  jobTypeManager: JobTypeManager | null
): void => {
  memoryManager?.stop();
  jobTypeManager?.stop();
  for (const limiter of modelLimiters.values()) {
    limiter.stop();
  }
};

/**
 * Convert resources per job config to job type keys array.
 */
export const getJobTypeKeysFromConfig = (
  resourcesPerJob: ResourcesPerJob | undefined
): string[] | undefined => (resourcesPerJob === undefined ? undefined : Object.keys(resourcesPerJob));

/** Build backend context params. */
export interface BuildBackendContextParams {
  backend: BackendConfig | DistributedBackendConfig | undefined;
  resourcesPerJob: ResourcesPerJob | undefined;
  instanceId: string;
  modelId: string;
  jobId: string;
  jobType?: string;
}

/** Build backend operation context. */
export const buildBackendContext = (params: BuildBackendContextParams): BackendOperationContext => ({
  backend: params.backend,
  resourcesPerJob: params.resourcesPerJob,
  instanceId: params.instanceId,
  modelId: params.modelId,
  jobId: params.jobId,
  jobType: params.jobType,
});

/**
 * Backend registration result.
 */
export interface BackendRegistrationResult {
  unsubscribe: Unsubscribe | null;
  allocation: AllocationInfo | null;
}

/**
 * Register with V2 backend if applicable.
 */
export const registerWithBackend = async (
  backend: BackendConfig | DistributedBackendConfig | undefined,
  instanceId: string,
  availabilityTracker: AvailabilityTracker | null
): Promise<BackendRegistrationResult> => {
  if (backend === undefined || !isV2Backend(backend)) {
    return { unsubscribe: null, allocation: null };
  }
  const allocation = await backend.register(instanceId);
  availabilityTracker?.setDistributedAllocation(allocation);
  const unsubscribe = backend.subscribe(instanceId, (alloc: AllocationInfo) => {
    availabilityTracker?.setDistributedAllocation(alloc);
  });
  return { unsubscribe, allocation };
};

/**
 * Unregister from V2 backend if applicable.
 */
export const unregisterFromBackend = (
  backend: BackendConfig | DistributedBackendConfig | undefined,
  instanceId: string
): void => {
  if (backend !== undefined && isV2Backend(backend)) {
    backend.unregister(instanceId).catch(() => {
      /* ignore */
    });
  }
};

/** Result of initializing a backend factory. */
export interface FactoryInitResult {
  factoryInstance: BackendFactoryInstance | null;
  resolvedBackend: BackendConfig | DistributedBackendConfig | undefined;
}

/**
 * Initialize backend factory if provided, or return the backend directly.
 */
export const initializeBackendFactory = async (
  backendOrFactory: BackendConfig | DistributedBackendConfig | DistributedBackendFactory | undefined,
  models: ModelsConfig,
  resourcesPerJob: ResourcesPerJob | undefined,
  order: readonly string[] | undefined
): Promise<FactoryInitResult> => {
  if (!isDistributedBackendFactory(backendOrFactory)) {
    return { factoryInstance: null, resolvedBackend: backendOrFactory };
  }

  const factoryInstance = await backendOrFactory.initialize({ models, resourcesPerJob, order });
  const resolvedBackend = factoryInstance.getBackendConfig();
  return { factoryInstance, resolvedBackend };
};

/**
 * Stop factory instance if present.
 */
export const stopBackendFactory = (factoryInstance: BackendFactoryInstance | null): null => {
  if (factoryInstance !== null) {
    factoryInstance.stop().catch(() => {
      // Ignore stop errors
    });
  }
  return null;
};

/**
 * Create job type manager if resources per job is configured.
 */
export const createOptionalJobTypeManager = (
  resourcesPerJob: ResourcesPerJob | undefined,
  ratioAdjustmentConfig: RatioAdjustmentConfig | undefined,
  label: string,
  onLog?: LogFn
): JobTypeManager | null =>
  resourcesPerJob === undefined
    ? null
    : createJobTypeManager({ resourcesPerJob, ratioAdjustmentConfig, label, onLog });

/** Acquire job type slot params. */
export interface AcquireJobTypeSlotParams {
  manager: JobTypeManager | null;
  resourcesConfig: ResourcesPerJob | undefined;
  jobType: string | undefined;
  pollIntervalMs: number;
  waitForCapacity: (hasCapacity: () => boolean, pollMs: number) => Promise<unknown>;
}

/** Try to acquire slot with retry on race condition. */
const tryAcquireWithRetry = async (
  manager: JobTypeManager,
  jobType: string,
  pollIntervalMs: number,
  waitForCapacity: (hasCapacity: () => boolean, pollMs: number) => Promise<unknown>
): Promise<boolean> => {
  await waitForCapacity(() => manager.hasCapacity(jobType), pollIntervalMs);
  if (manager.acquire(jobType)) {
    return true;
  }
  // Slot was acquired by another concurrent job, retry
  return await tryAcquireWithRetry(manager, jobType, pollIntervalMs, waitForCapacity);
};

/** Acquire job type slot if applicable. Returns true if slot was acquired. */
export const acquireJobTypeSlot = async (params: AcquireJobTypeSlotParams): Promise<boolean> => {
  const { manager, resourcesConfig, jobType, pollIntervalMs, waitForCapacity } = params;
  if (jobType === undefined || manager === null || resourcesConfig === undefined) {
    return false;
  }
  return await tryAcquireWithRetry(manager, jobType, pollIntervalMs, waitForCapacity);
};

const INSTANCE_ID_RADIX = 36;
const INSTANCE_ID_SLICE_START = 2;
const INSTANCE_ID_SLICE_END = 11;

/** Generate a unique instance ID for the rate limiter. */
export const generateInstanceId = (): string =>
  `inst-${Date.now()}-${Math.random().toString(INSTANCE_ID_RADIX).slice(INSTANCE_ID_SLICE_START, INSTANCE_ID_SLICE_END)}`;

/** Default label for the rate limiter. */
export const DEFAULT_LABEL = 'LLMRateLimiter';
/** Default polling interval in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 100;
/** Zero constant for avoiding magic numbers. */
export const ZERO = 0;

/** Initialize job type capacity on manager if present. */
export const initializeJobTypeCapacity = (manager: JobTypeManager | null, capacity: number): void => {
  manager?.setTotalCapacity(capacity);
};
