/**
 * Helper for building DelegationContext objects.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { ActiveJobInfo, AvailabilityChangeReason, JobUsage, UsageEntry } from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, LogFn, ReservationContext } from '../types.js';
import type { AvailabilityTracker } from './availabilityTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
import { addUsageWithCost, calculateJobAdjustment } from './costHelpers.js';
import type { DelegationContext } from './jobDelegation.js';
import type { JobTypeManager } from './jobTypeManager.js';
import type { MemoryManagerInstance } from './memoryManager.js';

/** Pricing config type for models */
type ModelPricingConfig = Record<string, { pricing: { input: number; cached: number; output: number } }>;

/** Debug log function signature */
type DebugLogFn = (message: string, data?: Record<string, unknown>) => void;

/** Create a debug logger from optional LogFn */
const createDebugLog = (onLog: LogFn | undefined, prefix: string): DebugLogFn => {
  if (onLog === undefined) return () => undefined;
  return (msg, data) => {
    onLog(`${prefix}| ${msg}`, data);
  };
};

/** Parameters for building a DelegationContext */
export interface DelegationContextParams {
  escalationOrder: readonly string[];
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  activeJobs: Map<string, ActiveJobInfo>;
  memoryManager: MemoryManagerInstance | null;
  availabilityTracker: AvailabilityTracker | null;
  models: ModelPricingConfig;
  hasCapacityForModel: (modelId: string) => boolean;
  tryReserveForModel: (modelId: string) => ReservationContext | null;
  releaseReservationForModel: (modelId: string, ctx: ReservationContext) => void;
  getAvailableModelExcluding: (exclude: ReadonlySet<string>) => string | null;
  backendCtx: (modelId: string, jobId: string, jobType: string) => BackendOperationContext;
  getModelLimiter: (modelId: string) => InternalLimiterInstance;
  /** Job type for per-model JTM enforcement (optional) */
  jobType?: string;
  /** Job type manager for per-model capacity enforcement (optional) */
  jobTypeManager?: JobTypeManager | null;
  /** Debug logger for tracing capacity decisions */
  onLog?: LogFn;
}

/** Create job adjustment emitter callback */
const createJobAdjustmentEmitter =
  (
    resourceEstimationsPerJob: ResourceEstimationsPerJob,
    availabilityTracker: AvailabilityTracker | null
  ): ((jobType: string, result: InternalJobResult, modelId: string) => void) =>
  (jobType, result, modelId) => {
    const adj = calculateJobAdjustment(resourceEstimationsPerJob, jobType, result);
    if (adj !== null) {
      availabilityTracker?.emitAdjustment(adj, modelId);
    }
  };

/** Create usage cost adder callback */
const createUsageCostAdder =
  (models: ModelPricingConfig): ((ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void) =>
  (ctx, modelId, usage) => {
    addUsageWithCost(models, ctx, modelId, usage);
  };

/** Create availability change emitter callback */
const createAvailabilityChangeEmitter =
  (
    availabilityTracker: AvailabilityTracker | null
  ): ((reason: AvailabilityChangeReason, modelId: string) => void) =>
  (reason, modelId) => {
    availabilityTracker?.checkAndEmit(reason, modelId);
  };

/** Per-model slot info for debug logging */
interface ModelSlotInfo {
  allocated: number;
  inFlight: number;
}

/** Parameters for logging a composedTryReserve attempt */
interface TryReserveLogParams {
  log: DebugLogFn;
  modelId: string;
  jobType: string;
  modelSlotInfo: ModelSlotInfo | undefined;
}

/** Log the result of a composedTryReserve attempt */
const logTryReserveAttempt = (params: TryReserveLogParams, result: string): void => {
  const { log, modelId, jobType, modelSlotInfo } = params;
  log(`composedTryReserve ${modelId}/${jobType}: ${result}`, {
    modelAllocated: modelSlotInfo?.allocated,
    modelInFlight: modelSlotInfo?.inFlight,
  });
};

/** Parameters for building composedTryReserve */
interface ComposedTryReserveParams {
  limiter: InternalLimiterInstance;
  jtm: JobTypeManager;
  modelId: string;
  jt: string;
  log: DebugLogFn;
}

/** Build composedTryReserve closure with debug logging */
const buildComposedTryReserve = (params: ComposedTryReserveParams): (() => ReservationContext | null) => {
  const { limiter, jtm, modelId, jt, log } = params;
  return (): ReservationContext | null => {
    const ctx = limiter.tryReserve();
    const logParams: TryReserveLogParams = {
      log,
      modelId,
      jobType: jt,
      modelSlotInfo: jtm.getModelJobTypeInfo(modelId, jt),
    };
    if (ctx === null) {
      logTryReserveAttempt(logParams, 'model.tryReserve=FAIL');
      return null;
    }
    const hasCapacity = jtm.hasCapacityForModel(modelId, jt);
    logTryReserveAttempt(logParams, hasCapacity ? 'OK' : 'JTM.hasCapacityForModel=FAIL');
    if (!hasCapacity) {
      limiter.releaseReservation(ctx);
      return null;
    }
    jtm.acquireForModel(modelId, jt);
    return ctx;
  };
};

/** Build composed wait function that includes JTM per-model check */
const buildComposedWaitForModel = (
  params: DelegationContextParams
): ((modelId: string, maxWaitMS: number) => Promise<ReservationContext | null>) => {
  const { getModelLimiter, jobType, jobTypeManager, onLog } = params;
  const log = createDebugLog(onLog, 'Delegation');
  if (jobTypeManager === undefined || jobTypeManager === null || jobType === undefined) {
    return async (modelId, maxWaitMS) => await getModelLimiter(modelId).waitForCapacityWithTimeout(maxWaitMS);
  }
  const jtm = jobTypeManager;
  const jt = jobType;
  return async (modelId, maxWaitMS) => {
    const limiter = getModelLimiter(modelId);
    log(`Waiting for ${modelId}/${jt}`, { maxWaitMS });
    const composedTryReserve = buildComposedTryReserve({ limiter, jtm, modelId, jt, log });
    const result = await limiter.waitForCapacityWithCustomReserve(composedTryReserve, maxWaitMS);
    log(`Wait result for ${modelId}/${jt}`, { reserved: result !== null });
    return result;
  };
};

/** Build release function for per-model job type slot */
const buildReleaseJobTypeForModel = (
  jobType: string | undefined,
  jobTypeManager: JobTypeManager | null | undefined,
  onLog: LogFn | undefined
): ((modelId: string) => void) => {
  if (jobTypeManager === undefined || jobTypeManager === null || jobType === undefined) {
    return () => undefined;
  }
  const jtm = jobTypeManager;
  const jt = jobType;
  const log = createDebugLog(onLog, 'Delegation');
  return (modelId) => {
    const infoBefore = jtm.getModelJobTypeInfo(modelId, jt);
    log(`releaseForModel ${modelId}/${jt}`, {
      modelInFlightBefore: infoBefore?.inFlight,
      modelAllocated: infoBefore?.allocated,
    });
    jtm.releaseForModel(modelId, jt);
  };
};

/** Build a DelegationContext from the given parameters */
export const buildDelegationContext = (params: DelegationContextParams): DelegationContext => {
  const {
    escalationOrder,
    resourceEstimationsPerJob,
    activeJobs,
    memoryManager,
    availabilityTracker,
    models,
    hasCapacityForModel,
    tryReserveForModel,
    releaseReservationForModel,
    getAvailableModelExcluding,
    backendCtx,
    getModelLimiter,
    jobType,
    jobTypeManager,
    onLog,
  } = params;

  return {
    escalationOrder,
    resourceEstimationsPerJob,
    activeJobs,
    memoryManager,
    hasCapacityForModel,
    tryReserveForModel,
    releaseReservationForModel,
    getAvailableModelExcluding,
    backendCtx,
    getModelLimiter,
    addUsageWithCost: createUsageCostAdder(models),
    emitAvailabilityChange: createAvailabilityChangeEmitter(availabilityTracker),
    emitJobAdjustment: createJobAdjustmentEmitter(resourceEstimationsPerJob, availabilityTracker),
    waitForCapacityWithTimeoutForModel: buildComposedWaitForModel(params),
    releaseJobTypeForModel: buildReleaseJobTypeForModel(jobType, jobTypeManager, onLog),
  };
};
