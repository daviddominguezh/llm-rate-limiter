import type { JobCallbackContext, JobResult, LLMJobResult } from '@llm-rate-limiter/core';
import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { HTTP_STATUS_ACCEPTED, HTTP_STATUS_BAD_REQUEST } from './constants.js';
import { handleJobComplete, handleJobError, processJob } from './jobHandler.js';
import { logger } from './logger.js';
import type { ServerState } from './serverState.js';
import type { ErrorResponse, QueueJobResponse } from './types.js';
import { validateQueueJobRequest } from './validation.js';

const ZERO_COST = 0;

/** Dependencies for routes */
export interface RoutesDeps {
  state: ServerState;
}

interface QueueJobToLimiterParams {
  state: ServerState;
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

/** Tracking info for a job */
interface JobTrackingInfo {
  queuedAt: number;
  startedAt: number | null;
  modelsTried: string[];
}

/** Job data returned by processJob */
interface JobData {
  processed: boolean;
  jobId: string;
  jobType: string;
}

/** Arguments passed to job executor by rate limiter */
interface JobExecutorArgs {
  modelId: string;
}

/** Parameters for creating the job executor function */
interface JobExecutorParams {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  tracking: JobTrackingInfo;
  eventEmitter: ServerState['eventEmitter'];
}

/** Create the job executor function */
const createJobExecutor =
  (params: JobExecutorParams) =>
  async (args: JobExecutorArgs): Promise<JobResult<JobData>> => {
    const { jobId, jobType, payload, tracking, eventEmitter } = params;
    const { modelId } = args;
    // Track when job starts and which model
    tracking.startedAt = Date.now();
    if (!tracking.modelsTried.includes(modelId)) {
      tracking.modelsTried.push(modelId);
    }

    // Emit job:started event
    eventEmitter.emitJobStarted({ jobId, jobType, modelId });

    return await processJob({ jobId, jobType, payload, modelId });
  };

/** Parameters for the completion handler */
interface CompletionHandlerParams {
  jobId: string;
  jobType: string;
  tracking: JobTrackingInfo;
  eventEmitter: ServerState['eventEmitter'];
  jobHistoryTracker: ServerState['jobHistoryTracker'];
}

/** Create the completion handler function */
const createCompletionHandler =
  (params: CompletionHandlerParams) =>
  (result: LLMJobResult<JobData>, context: JobCallbackContext): void => {
    const { jobId, jobType, tracking, eventEmitter, jobHistoryTracker } = params;
    const { modelUsed } = result;
    const { totalCost } = context;
    const completedAt = Date.now();
    const durationMs = completedAt - tracking.queuedAt;

    eventEmitter.emitJobCompleted({
      jobId,
      jobType,
      modelUsed,
      totalCost,
      durationMs,
      usage: context.usage,
    });

    jobHistoryTracker.recordCompleted({
      jobId,
      jobType,
      modelUsed,
      queuedAt: tracking.queuedAt,
      startedAt: tracking.startedAt ?? tracking.queuedAt,
      totalCost,
      modelsTried: tracking.modelsTried,
    });

    handleJobComplete({
      jobId,
      modelUsed,
      totalCost,
    });
  };

/** Parameters for the error handler */
interface ErrorHandlerParams {
  jobId: string;
  jobType: string;
  tracking: JobTrackingInfo;
  eventEmitter: ServerState['eventEmitter'];
  jobHistoryTracker: ServerState['jobHistoryTracker'];
}

/** Create the error handler function */
const createErrorHandler =
  (params: ErrorHandlerParams) =>
  (error: Error, context: JobCallbackContext): void => {
    const { jobId, jobType, tracking, eventEmitter, jobHistoryTracker } = params;
    const { totalCost } = context;

    eventEmitter.emitJobFailed({
      jobId,
      jobType,
      error: error.message,
      modelsTried: tracking.modelsTried,
      totalCost,
      usage: context.usage,
    });

    jobHistoryTracker.recordFailed({
      jobId,
      jobType,
      error: error.message,
      queuedAt: tracking.queuedAt,
      startedAt: tracking.startedAt,
      totalCost,
      modelsTried: tracking.modelsTried,
    });

    handleJobError({
      jobId,
      error,
      totalCost,
    });
  };

/** Handle queue errors */
const handleQueueError = (error: unknown, params: ErrorHandlerParams): void => {
  const { jobId, jobType, tracking, eventEmitter, jobHistoryTracker } = params;
  const errorMessage = error instanceof Error ? error.message : String(error);

  eventEmitter.emitJobFailed({
    jobId,
    jobType,
    error: errorMessage,
    modelsTried: tracking.modelsTried,
    totalCost: ZERO_COST,
    usage: [],
  });

  jobHistoryTracker.recordFailed({
    jobId,
    jobType,
    error: errorMessage,
    queuedAt: tracking.queuedAt,
    startedAt: tracking.startedAt,
    totalCost: ZERO_COST,
    modelsTried: tracking.modelsTried,
  });

  logger.error(`Job ${jobId} queue error`, { error: errorMessage });
};

const queueJobToLimiter = (params: QueueJobToLimiterParams): void => {
  const { state, jobId, jobType, payload } = params;
  const { rateLimiter, eventEmitter, jobHistoryTracker } = state;

  const tracking: JobTrackingInfo = {
    queuedAt: Date.now(),
    startedAt: null,
    modelsTried: [],
  };

  eventEmitter.emitJobQueued({ jobId, jobType });

  const handlerParams = { jobId, jobType, tracking, eventEmitter, jobHistoryTracker };

  rateLimiter
    .queueJob({
      jobId,
      jobType,
      job: createJobExecutor({ jobId, jobType, payload, tracking, eventEmitter }),
      onComplete: createCompletionHandler(handlerParams),
      onError: createErrorHandler(handlerParams),
    })
    .catch((error: unknown) => {
      handleQueueError(error, handlerParams);
    });
};

export const createRoutes = (deps: RoutesDeps): Router => {
  const { state } = deps;
  const router = createRouter();

  router.post('/queue-job', (req: Request, res: Response<QueueJobResponse | ErrorResponse>): void => {
    const validation = validateQueueJobRequest(req.body);

    if (!validation.valid) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({ error: validation.error });
      return;
    }

    const { data } = validation;

    queueJobToLimiter({
      ...data,
      state,
    });

    res.status(HTTP_STATUS_ACCEPTED).json({ jobId: data.jobId });
  });

  return router;
};
