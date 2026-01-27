// Main factory function
export { createLLMRateLimiter } from './multiModelRateLimiter.js';

// Keep generic types from types.ts
export type { TokenUsage, MemoryLimitConfig } from './types.js';

// Public types from multiModelTypes.ts
export type {
  ArgsWithoutModelId,
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
  QueueJobOptions,
  UsageEntry,
  UsageEntryWithCost,
  ValidatedLLMRateLimiterConfig,
} from './multiModelTypes.js';
