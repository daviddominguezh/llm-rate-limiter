/**
 * Helper operations for the rate limiter.
 */
import type { BackendFactoryInstance, DistributedBackendFactory } from '../backendFactoryTypes.js';
import { isDistributedBackendFactory } from '../backendFactoryTypes.js';
import type { JobTypeStats, RatioAdjustmentConfig, ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  AllocationInfo,
  BackendConfig,
  LLMRateLimiterStats,
  ModelsConfig,
  Unsubscribe,
} from '../multiModelTypes.js';
import type { InternalLimiterInstance, InternalLimiterStats, LogFn } from '../types.js';
import type { AvailabilityTracker } from './availabilityTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
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
  resourcesPerJob: ResourceEstimationsPerJob | undefined
): string[] | undefined => (resourcesPerJob === undefined ? undefined : Object.keys(resourcesPerJob));

/** Build backend context params. */
export interface BuildBackendContextParams {
  backend: BackendConfig | undefined;
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  instanceId: string;
  modelId: string;
  jobId: string;
  jobType: string;
}

/** Build backend operation context. */
export const buildBackendContext = (params: BuildBackendContextParams): BackendOperationContext => ({
  backend: params.backend,
  resourceEstimationsPerJob: params.resourceEstimationsPerJob,
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

/** Callback for applying allocation to rate limiters */
export type AllocationApplyCallback = (allocation: AllocationInfo) => void;

/**
 * Register with backend.
 */
export const registerWithBackend = async (
  backend: BackendConfig | undefined,
  instanceId: string,
  availabilityTracker: AvailabilityTracker | null,
  onAllocationChange?: AllocationApplyCallback
): Promise<BackendRegistrationResult> => {
  if (backend === undefined) {
    return { unsubscribe: null, allocation: null };
  }
  const allocation = await backend.register(instanceId);
  availabilityTracker?.setDistributedAllocation(allocation);
  onAllocationChange?.(allocation);
  const unsubscribe = backend.subscribe(instanceId, (alloc: AllocationInfo) => {
    availabilityTracker?.setDistributedAllocation(alloc);
    onAllocationChange?.(alloc);
  });
  return { unsubscribe, allocation };
};

/**
 * Unregister from backend.
 */
export const unregisterFromBackend = (backend: BackendConfig | undefined, instanceId: string): void => {
  if (backend !== undefined) {
    backend.unregister(instanceId).catch(() => {
      /* ignore */
    });
  }
};

/** Result of initializing a backend factory. */
export interface FactoryInitResult {
  factoryInstance: BackendFactoryInstance | null;
  resolvedBackend: BackendConfig | undefined;
}

/**
 * Initialize backend factory if provided, or return the backend directly.
 */
export const initializeBackendFactory = async (
  backendOrFactory: BackendConfig | DistributedBackendFactory | undefined,
  models: ModelsConfig,
  resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined,
  escalationOrder: readonly string[] | undefined
): Promise<FactoryInitResult> => {
  if (!isDistributedBackendFactory(backendOrFactory)) {
    return { factoryInstance: null, resolvedBackend: backendOrFactory };
  }

  const factoryInstance = await backendOrFactory.initialize({
    models,
    resourceEstimationsPerJob,
    escalationOrder,
  });
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
  resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined,
  ratioAdjustmentConfig: RatioAdjustmentConfig | undefined,
  label: string,
  onLog?: LogFn
): JobTypeManager | null =>
  resourceEstimationsPerJob === undefined
    ? null
    : createJobTypeManager({ resourceEstimationsPerJob, ratioAdjustmentConfig, label, onLog });

/** Acquire job type slot params. */
export interface AcquireJobTypeSlotParams {
  manager: JobTypeManager | null;
  resourcesConfig: ResourceEstimationsPerJob | undefined;
  jobType: string;
}

/** Acquire job type slot if applicable. Returns true if slot was acquired. */
export const acquireJobTypeSlot = async (params: AcquireJobTypeSlotParams): Promise<boolean> => {
  const { manager, resourcesConfig, jobType } = params;
  if (manager === null || resourcesConfig === undefined) {
    return false;
  }
  await manager.acquire(jobType);
  return true;
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
