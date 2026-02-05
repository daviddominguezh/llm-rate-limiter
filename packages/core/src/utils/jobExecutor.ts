/**
 * Job execution helpers for the LLM Rate Limiter.
 */
import type {
  ArgsWithoutModelId,
  JobCallbackContext,
  JobExecutionContext,
  JobResult,
  JobUsage,
  LLMJobResult,
  TokenUsageEntry,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, ReservationContext } from '../types.js';
import {
  DelegationError,
  type DelegationUsage,
  buildJobArgs,
  calculateTotalCost,
} from './jobExecutionHelpers.js';

/** Mutable state for job execution callbacks */
export interface JobExecutionState {
  rejected: boolean;
  shouldDelegate: boolean;
  rejectedWithoutDelegation: boolean;
  /** Usage recorded at rejection time - preserves token breakdown for cost tracking */
  rejectUsage: DelegationUsage | null;
}

/** Create initial job execution state */
export const createJobExecutionState = (): JobExecutionState => ({
  rejected: false,
  shouldDelegate: false,
  rejectedWithoutDelegation: false,
  rejectUsage: null,
});

/** Context for job execution on a specific model */
export interface ModelJobContext<T, Args extends ArgsWithoutModelId = ArgsWithoutModelId> {
  ctx: JobExecutionContext<T, Args>;
  modelId: string;
  /** Reservation context for time-window-aware capacity refunds */
  reservationContext: ReservationContext;
  limiter: InternalLimiterInstance;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
  emitAvailabilityChange: (modelId: string) => void;
  emitJobAdjustment: (jobType: string, result: InternalJobResult, modelId: string) => void;
  releaseResources: (result: InternalJobResult) => void;
}

/** Reject handler context */
interface RejectHandlerContext {
  stateRef: JobExecutionState;
  ctx: { usage: JobUsage };
  modelId: string;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
}

/** Create reject handler for job execution */
const createRejectHandler = (
  handlerCtx: RejectHandlerContext
): ((usage: TokenUsageEntry, opts?: { delegate?: boolean }) => void) => {
  const { stateRef, ctx, modelId, addUsageWithCost } = handlerCtx;
  const mutableState = stateRef;
  return (usage, opts) => {
    mutableState.rejected = true;
    const usageEntry: UsageEntry = { modelId, ...usage };
    addUsageWithCost(ctx, modelId, usageEntry);
    // Store usage for DelegationError - preserves token breakdown for accurate cost tracking
    mutableState.rejectUsage = {
      requests: usage.requestCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
    };
    mutableState.shouldDelegate = opts?.delegate !== false;
    if (!mutableState.shouldDelegate) {
      mutableState.rejectedWithoutDelegation = true;
    }
  };
};

/** Check if job was rejected and handle delegation */
const checkRejection = (state: JobExecutionState): void => {
  if (state.rejectedWithoutDelegation) {
    throw new Error('Job rejected without delegation');
  }
  if (state.shouldDelegate) {
    throw new DelegationError(
      state.rejectUsage ?? { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }
    );
  }
};

/** Build InternalJobResult from job result */
const buildInternalJobResult = <T>(result: JobResult<T>): InternalJobResult => ({
  requestCount: result.requestCount,
  usage: {
    input: result.inputTokens,
    output: result.outputTokens,
    cached: result.cachedTokens,
  },
});

/** Add usage from successful job result */
const addSuccessUsage = <T>(
  result: JobResult<T>,
  modelId: string,
  ctx: { usage: JobUsage },
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void
): void => {
  const usageEntry: UsageEntry = {
    modelId,
    requestCount: result.requestCount,
    inputTokens: result.inputTokens,
    cachedTokens: result.cachedTokens,
    outputTokens: result.outputTokens,
  };
  addUsageWithCost(ctx, modelId, usageEntry);
};

/** Build final result with callback context */
export const buildFinalResult = <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  data: T,
  modelId: string,
  ctx: JobExecutionContext<T, Args>
): LLMJobResult<T> => {
  const finalResult: LLMJobResult<T> = { data, modelUsed: modelId };
  const callbackContext: JobCallbackContext = {
    jobId: ctx.jobId,
    totalCost: calculateTotalCost(ctx.usage),
    usage: ctx.usage,
  };
  if (ctx.onComplete !== undefined) {
    ctx.onComplete(finalResult, callbackContext);
  }
  return finalResult;
};

/** Execute job on a specific model with all the callback handling */
export const executeJobWithCallbacks = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  jobContext: ModelJobContext<T, Args>
): Promise<LLMJobResult<T>> => {
  const {
    ctx,
    modelId,
    reservationContext,
    limiter,
    addUsageWithCost,
    emitAvailabilityChange,
    emitJobAdjustment,
    releaseResources,
  } = jobContext;

  const state = createJobExecutionState();
  const handlerCtx = { stateRef: state, ctx, modelId, addUsageWithCost };
  const handleReject = createRejectHandler(handlerCtx);

  emitAvailabilityChange(modelId);
  const resultContainer: { data: T | null } = { data: null };
  // Use queueJobWithReservedCapacity with reservation context for time-window-aware refunds
  const internalResult = await limiter.queueJobWithReservedCapacity(async () => {
    const jobArgs = buildJobArgs<Args>(modelId, ctx.args);
    const result = await ctx.job(jobArgs, handleReject);
    checkRejection(state);
    ({ data: resultContainer.data } = result);
    addSuccessUsage(result, modelId, ctx, addUsageWithCost);
    return buildInternalJobResult(result);
  }, reservationContext);

  emitJobAdjustment(ctx.jobType, internalResult, modelId);
  releaseResources(internalResult);
  if (resultContainer.data === null) {
    throw new Error('Job did not return a result');
  }
  return buildFinalResult(resultContainer.data, modelId, ctx);
};
