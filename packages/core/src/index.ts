// Main factory function
export { createLLMRateLimiter } from './multiModelRateLimiter.js';

// Keep generic types from types.ts
export type { TokenUsage, MemoryLimitConfig } from './types.js';

// Job type types
export type {
  JobTypeIds,
  JobTypeLoadMetrics,
  JobTypeRatioConfig,
  JobTypeResourceConfig,
  JobTypeState,
  JobTypeStats,
  MaxWaitMSConfig,
  RatioAdjustmentConfig,
  ResourceEstimationsPerJob,
} from './jobTypeTypes.js';
export { DEFAULT_RATIO_ADJUSTMENT_CONFIG } from './jobTypeTypes.js';

// Public types from multiModelTypes.ts
export type {
  // Active job tracking types
  ActiveJobInfo,
  ActiveJobStatus,
  // Job types
  ArgsWithoutModelId,
  Availability,
  AvailabilityChangeReason,
  JobArgs,
  JobCallbackContext,
  JobRejectOptions,
  JobUsage,
  LLMJob,
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterConfigBase,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  ModelPricing,
  ModelRateLimitConfig,
  ModelsConfig,
  OnAvailableSlotsChange,
  QueueJobOptions,
  RelativeAvailabilityAdjustment,
  JobResult,
  TokenUsageEntry,
  UsageEntry,
  UsageEntryWithCost,
  ValidatedLLMRateLimiterConfig,
  // Backend types
  BackendConfig,
  BackendAcquireContext,
  BackendReleaseContext,
  BackendEstimatedResources,
  BackendActualResources,
  AllocationInfo,
  ModelPoolAllocation,
  DynamicLimitConfig,
  DynamicLimits,
  AllocationCallback,
  Unsubscribe,
  DistributedAvailability,
  // Backend factory types
  DistributedBackendFactory,
  BackendFactoryInitConfig,
  BackendFactoryInstance,
} from './multiModelTypes.js';
export { isDistributedBackendFactory } from './multiModelTypes.js';

// Helper functions
export { getDefaultMaxWaitMS } from './utils/jobExecutionHelpers.js';
export { calculateModelJobTypeSlots } from './utils/jobTypeSlotCalculation.js';
