/**
 * Job delegation logic for the LLM Rate Limiter.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  ActiveJobInfo,
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  JobExecutionContext,
  JobUsage,
  LLMJobResult,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, ReservationContext } from '../types.js';
import {
  addJobTriedModel,
  clearJobTriedModels,
  updateJobProcessing,
  updateJobWaiting,
} from './activeJobTracker.js';
import type { BackendOperationContext } from './backendHelpers.js';
import { acquireBackend, releaseBackend } from './backendHelpers.js';
import {
  buildErrorCallbackContext,
  getMaxWaitMS,
  isDelegationError,
  selectModelWithWait,
  toErrorObject,
} from './jobExecutionHelpers.js';
import { executeJobWithCallbacks } from './jobExecutor.js';
import { ZERO } from './rateLimiterOperations.js';

/** Context for job delegation operations */
export interface DelegationContext {
  escalationOrder: readonly string[];
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  activeJobs: Map<string, ActiveJobInfo>;
  memoryManager: { acquire: (jobType: string) => Promise<void>; release: (jobType: string) => void } | null;
  hasCapacityForModel: (modelId: string) => boolean;
  /** Atomically reserve capacity for a model. Returns ReservationContext if reserved, null if no capacity. */
  tryReserveForModel: (modelId: string) => ReservationContext | null;
  /** Release previously reserved capacity for a model (respects time windows). */
  releaseReservationForModel: (modelId: string, context: ReservationContext) => void;
  getAvailableModelExcluding: (exclude: ReadonlySet<string>) => string | null;
  backendCtx: (modelId: string, jobId: string, jobType: string) => BackendOperationContext;
  getModelLimiter: (modelId: string) => InternalLimiterInstance;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
  emitAvailabilityChange: (reason: AvailabilityChangeReason, modelId: string) => void;
  emitJobAdjustment: (jobType: string, result: InternalJobResult, modelId: string) => void;
}

/** Execute job on a specific model */
export const executeOnModel = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  dctx: DelegationContext,
  ctx: JobExecutionContext<T, Args>,
  modelId: string,
  reservationContext: ReservationContext
): Promise<LLMJobResult<T>> => {
  updateJobProcessing(dctx.activeJobs, ctx.jobId, modelId);
  return await executeJobWithCallbacks({
    ctx,
    modelId,
    reservationContext,
    limiter: dctx.getModelLimiter(modelId),
    addUsageWithCost: dctx.addUsageWithCost,
    emitAvailabilityChange: (m) => {
      dctx.emitAvailabilityChange('tokensMinute', m);
    },
    emitJobAdjustment: dctx.emitJobAdjustment,
    releaseResources: (result) => {
      dctx.memoryManager?.release(ctx.jobType);
      const actual = { requests: result.requestCount, tokens: result.usage.input + result.usage.output + result.usage.cached };
      releaseBackend(dctx.backendCtx(modelId, ctx.jobId, ctx.jobType), actual, reservationContext.windowStarts);
    },
  });
};

/** Error handling params */
interface HandleErrorParams<T, Args extends ArgsWithoutModelId> {
  dctx: DelegationContext;
  ctx: JobExecutionContext<T, Args>;
  modelId: string;
  reservationContext: ReservationContext;
  error: unknown;
}

/** Handle execution error with potential delegation */
const handleError = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  params: HandleErrorParams<T, Args>
): Promise<LLMJobResult<T>> => {
  const { dctx, ctx, modelId, reservationContext, error } = params;
  dctx.memoryManager?.release(ctx.jobType);

  // Extract actual usage from DelegationError, or use zero for other errors
  // When reject(usage) is called, DelegationError carries the actual usage
  const actualUsage = isDelegationError(error)
    ? error.usage
    : { requests: ZERO, tokens: ZERO };

  releaseBackend(dctx.backendCtx(modelId, ctx.jobId, ctx.jobType), actualUsage, reservationContext.windowStarts);

  if (isDelegationError(error)) {
    if (dctx.getAvailableModelExcluding(ctx.triedModels) === null) {
      ctx.triedModels.clear();
    }
    return await executeWithDelegation(dctx, ctx);
  }
  const err = toErrorObject(error);
  ctx.onError?.(err, buildErrorCallbackContext(ctx.jobId, ctx.usage));
  throw err;
};

/** Execute job with delegation support */
export const executeWithDelegation = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  dctx: DelegationContext,
  ctx: JobExecutionContext<T, Args>
): Promise<LLMJobResult<T>> => {
  const { modelId: selectedModel, reservationContext, allModelsExhausted } = await selectModelWithWait({
    escalationOrder: dctx.escalationOrder,
    triedModels: ctx.triedModels,
    hasCapacityForModel: dctx.hasCapacityForModel,
    tryReserveForModel: dctx.tryReserveForModel,
    getMaxWaitMSForModel: (m) => getMaxWaitMS(dctx.resourceEstimationsPerJob, ctx.jobType, m),
    waitForCapacityWithTimeoutForModel: (m, maxWaitMS) =>
      dctx.getModelLimiter(m).waitForCapacityWithTimeout(maxWaitMS),
    onWaitingForModel: (modelId, maxWaitMS) => {
      updateJobWaiting(dctx.activeJobs, ctx.jobId, modelId, maxWaitMS);
    },
  });

  if (selectedModel === null || reservationContext === null) {
    if (allModelsExhausted) {
      throw new Error('All models exhausted: no capacity available within maxWaitMS');
    }
    ctx.triedModels.clear();
    clearJobTriedModels(dctx.activeJobs, ctx.jobId);
    return await executeWithDelegation(dctx, ctx);
  }

  // Capacity was reserved by tryReserveForModel during selectModelWithWait
  ctx.triedModels.add(selectedModel);
  addJobTriedModel(dctx.activeJobs, ctx.jobId, selectedModel);

  // Try to acquire memory for this job type
  try {
    await dctx.memoryManager?.acquire(ctx.jobType);
  } catch {
    // Release the reserved capacity since we can't proceed (respects time windows)
    dctx.releaseReservationForModel(selectedModel, reservationContext);
    throw new Error('Failed to acquire memory');
  }

  // Try to acquire backend
  if (!(await acquireBackend(dctx.backendCtx(selectedModel, ctx.jobId, ctx.jobType)))) {
    dctx.memoryManager?.release(ctx.jobType);
    dctx.releaseReservationForModel(selectedModel, reservationContext);
    if (ctx.triedModels.size >= dctx.escalationOrder.length) {
      throw new Error('All models rejected by backend');
    }
    return await executeWithDelegation(dctx, ctx);
  }

  try {
    return await executeOnModel(dctx, ctx, selectedModel, reservationContext);
  } catch (error) {
    return await handleError({ dctx, ctx, modelId: selectedModel, reservationContext, error });
  }
};
