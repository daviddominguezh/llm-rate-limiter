/**
 * Type definitions for the JobTypeManager.
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type {
  JobTypeState,
  JobTypeStats,
  RatioAdjustmentConfig,
  ResourceEstimationsPerJob,
} from '../jobTypeTypes.js';
import type { LogFn } from '../types.js';

/** Callback when ratios change */
export type OnRatioChangeCallback = (ratios: Map<string, number>) => void;

/**
 * Configuration for creating a JobTypeManager.
 */
export interface JobTypeManagerConfig {
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  ratioAdjustmentConfig?: RatioAdjustmentConfig;
  label: string;
  onLog?: LogFn;
  /** Called when ratios are adjusted (for memory manager to resize pools) */
  onRatioChange?: OnRatioChangeCallback;
  /** Called when a per-model slot is released (for notifying model limiter wait queues) */
  onModelCapacityRelease?: (modelId: string) => void;
}

/** Waiter in the queue for a job type slot */
export interface QueuedWaiter {
  resolve: () => void;
}

/**
 * Interface for the JobTypeManager.
 */
export interface JobTypeManager {
  getState: (jobTypeId: string) => JobTypeState | undefined;
  getAllStates: () => Record<string, JobTypeState>;
  hasCapacity: (jobTypeId: string) => boolean;
  acquire: (jobTypeId: string) => Promise<void>;
  release: (jobTypeId: string) => void;
  setTotalCapacity: (totalSlots: number) => void;
  getTotalCapacity: () => number;
  adjustRatios: () => void;
  getStats: () => JobTypeStats;
  stop: () => void;
  /** Set per-model pool allocation (distributed mode) */
  setModelPool: (modelId: string, pool: ModelPoolAllocation) => void;
  /** Check if a specific (model, jobType) pair has available capacity */
  hasCapacityForModel: (modelId: string, jobTypeId: string) => boolean;
  /** Acquire a per-model slot for a (model, jobType) pair */
  acquireForModel: (modelId: string, jobTypeId: string) => void;
  /** Release a per-model slot for a (model, jobType) pair */
  releaseForModel: (modelId: string, jobTypeId: string) => void;
  /** Get per-model allocated and inFlight for a (model, jobType) pair */
  getModelJobTypeInfo: (
    modelId: string,
    jobTypeId: string
  ) => { allocated: number; inFlight: number } | undefined;
}
