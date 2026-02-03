/**
 * Job execution helpers for the LLM Rate Limiter.
 */
import type {
  ArgsWithoutModelId,
  JobCallbackContext,
  JobExecutionContext,
  JobUsage,
  LLMJobResult,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance } from '../types.js';
import { DelegationError, buildJobArgs, calculateTotalCost } from './jobExecutionHelpers.js';

/** Mutable state for job execution callbacks */
export interface JobExecutionState {
  callbackCalled: boolean;
  shouldDelegate: boolean;
  rejectedWithoutDelegation: boolean;
}

/** Create initial job execution state */
export const createJobExecutionState = (): JobExecutionState => ({
  callbackCalled: false,
  shouldDelegate: false,
  rejectedWithoutDelegation: false,
});

/** Context for job execution on a specific model */
export interface ModelJobContext<T extends InternalJobResult, Args extends ArgsWithoutModelId> {
  ctx: JobExecutionContext<T, Args>;
  modelId: string;
  limiter: InternalLimiterInstance;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
  emitAvailabilityChange: (modelId: string) => void;
  emitJobAdjustment: (jobType: string, result: InternalJobResult, modelId: string) => void;
  releaseResources: (result: InternalJobResult) => void;
}

/** Resolve handler context */
interface ResolveHandlerContext {
  stateRef: JobExecutionState;
  ctx: { usage: JobUsage };
  modelId: string;
  addUsageWithCost: (ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry) => void;
}

/** Create resolve handler for job execution */
const createResolveHandler = (handlerCtx: ResolveHandlerContext): ((usage: UsageEntry) => void) => {
  const { stateRef, ctx, modelId, addUsageWithCost } = handlerCtx;
  const mutableState = stateRef;
  return (usage) => {
    mutableState.callbackCalled = true;
    addUsageWithCost(ctx, modelId, usage);
  };
};

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
): ((usage: UsageEntry, opts?: { delegate?: boolean }) => void) => {
  const { stateRef, ctx, modelId, addUsageWithCost } = handlerCtx;
  const mutableState = stateRef;
  return (usage, opts) => {
    mutableState.callbackCalled = true;
    addUsageWithCost(ctx, modelId, usage);
    mutableState.shouldDelegate = opts?.delegate !== false;
    if (!mutableState.shouldDelegate) {
      mutableState.rejectedWithoutDelegation = true;
    }
  };
};

/** Validate job callback was called and handle delegation */
const validateJobExecution = (state: JobExecutionState): void => {
  if (!state.callbackCalled) {
    throw new Error('Job must call resolve() or reject()');
  }
  if (state.rejectedWithoutDelegation) {
    throw new Error('Job rejected without delegation');
  }
  if (state.shouldDelegate) {
    throw new DelegationError();
  }
};

/** Build final result with callback context */
export const buildFinalResult = <T extends InternalJobResult, Args extends ArgsWithoutModelId>(
  result: T,
  modelId: string,
  ctx: JobExecutionContext<T, Args>
): LLMJobResult<T> => {
  const finalResult = { ...result, modelUsed: modelId };
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
export const executeJobWithCallbacks = async <T extends InternalJobResult, Args extends ArgsWithoutModelId>(
  jobContext: ModelJobContext<T, Args>
): Promise<LLMJobResult<T>> => {
  const {
    ctx,
    modelId,
    limiter,
    addUsageWithCost,
    emitAvailabilityChange,
    emitJobAdjustment,
    releaseResources,
  } = jobContext;

  const state = createJobExecutionState();
  const handlerCtx = { stateRef: state, ctx, modelId, addUsageWithCost };
  const handleResolve = createResolveHandler(handlerCtx);
  const handleReject = createRejectHandler(handlerCtx);

  emitAvailabilityChange(modelId);
  const result = await limiter.queueJob(async () => {
    const jobArgs = buildJobArgs<Args>(modelId, ctx.args);
    const jobResult = await ctx.job(jobArgs, handleResolve, handleReject);
    validateJobExecution(state);
    return jobResult;
  });

  emitJobAdjustment(ctx.jobType, result, modelId);
  releaseResources(result);
  return buildFinalResult(result, modelId, ctx);
};
