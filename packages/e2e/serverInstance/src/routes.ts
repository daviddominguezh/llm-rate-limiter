import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { HTTP_STATUS_ACCEPTED, HTTP_STATUS_BAD_REQUEST } from './constants.js';
import { handleJobComplete, handleJobError, processJob } from './jobHandler.js';
import { logger } from './logger.js';
import type { ServerState } from './serverState.js';
import type { ErrorResponse, QueueJobResponse } from './types.js';
import { validateQueueJobRequest } from './validation.js';

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

const queueJobToLimiter = (params: QueueJobToLimiterParams): void => {
  const { state, jobId, jobType, payload } = params;
  const { rateLimiter, eventEmitter, jobHistoryTracker } = state;

  // Track timing info
  const tracking: JobTrackingInfo = {
    queuedAt: Date.now(),
    startedAt: null,
    modelsTried: [],
  };

  // Emit job:queued event
  eventEmitter.emitJobQueued({ jobId, jobType });

  rateLimiter
    .queueJob({
      jobId,
      jobType,
      job: (args) => {
        // Track when job starts and which model
        tracking.startedAt = Date.now();
        if (!tracking.modelsTried.includes(args.modelId)) {
          tracking.modelsTried.push(args.modelId);
        }

        // Emit job:started event
        eventEmitter.emitJobStarted({ jobId, jobType, modelId: args.modelId });

        return processJob({ jobId, jobType, payload, modelId: args.modelId });
      },
      onComplete: (result, context) => {
        const completedAt = Date.now();
        const durationMs = completedAt - tracking.queuedAt;

        // Emit job:completed event
        eventEmitter.emitJobCompleted({
          jobId,
          jobType,
          modelUsed: result.modelUsed,
          totalCost: context.totalCost,
          durationMs,
        });

        // Record in job history
        jobHistoryTracker.recordCompleted({
          jobId,
          jobType,
          modelUsed: result.modelUsed,
          queuedAt: tracking.queuedAt,
          startedAt: tracking.startedAt ?? tracking.queuedAt,
          totalCost: context.totalCost,
          modelsTried: tracking.modelsTried,
        });

        handleJobComplete({
          jobId,
          modelUsed: result.modelUsed,
          totalCost: context.totalCost,
        });
      },
      onError: (error, context) => {
        // Emit job:failed event
        eventEmitter.emitJobFailed({
          jobId,
          jobType,
          error: error.message,
          modelsTried: tracking.modelsTried,
          totalCost: context.totalCost,
        });

        // Record in job history
        jobHistoryTracker.recordFailed({
          jobId,
          jobType,
          error: error.message,
          queuedAt: tracking.queuedAt,
          startedAt: tracking.startedAt,
          totalCost: context.totalCost,
          modelsTried: tracking.modelsTried,
        });

        handleJobError({
          jobId,
          error,
          totalCost: context.totalCost,
        });
      },
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit job:failed event for queue errors
      eventEmitter.emitJobFailed({
        jobId,
        jobType,
        error: errorMessage,
        modelsTried: tracking.modelsTried,
        totalCost: 0,
      });

      // Record in job history
      jobHistoryTracker.recordFailed({
        jobId,
        jobType,
        error: errorMessage,
        queuedAt: tracking.queuedAt,
        startedAt: tracking.startedAt,
        totalCost: 0,
        modelsTried: tracking.modelsTried,
      });

      logger.error(`Job ${jobId} queue error`, { error: errorMessage });
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
