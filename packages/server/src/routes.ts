import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { HTTP_STATUS_ACCEPTED, HTTP_STATUS_BAD_REQUEST } from './constants.js';
import { handleJobComplete, handleJobError, processJob } from './jobHandler.js';
import { logger } from './logger.js';
import type { ServerRateLimiter } from './rateLimiterSetup.js';
import type { ErrorResponse, QueueJobResponse } from './types.js';
import { validateQueueJobRequest } from './validation.js';

interface QueueJobToLimiterParams {
  rateLimiter: ServerRateLimiter;
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

const createQueueJobHandler =
  (rateLimiter: ServerRateLimiter) =>
  (req: Request, res: Response<QueueJobResponse | ErrorResponse>): void => {
    const validation = validateQueueJobRequest(req.body);

    if (!validation.valid) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({
        success: false,
        error: validation.error,
      });
      return;
    }

    const { data } = validation;
    const { jobId, jobType, payload } = data;

    queueJobToLimiter({ rateLimiter, jobId, jobType, payload });

    res.status(HTTP_STATUS_ACCEPTED).json({
      success: true,
      jobId,
      message: 'Job queued successfully',
    });
  };

const queueJobToLimiter = (params: QueueJobToLimiterParams): void => {
  const { rateLimiter, jobId, jobType, payload } = params;

  rateLimiter
    .queueJob({
      jobId,
      jobType: 'default',
      job: (args) => processJob({ jobId, jobType, payload, modelId: args.modelId }),
      onComplete: (result, context) => {
        handleJobComplete({
          jobId,
          modelUsed: result.modelUsed,
          totalCost: context.totalCost,
        });
      },
      onError: (error, context) => {
        handleJobError({
          jobId,
          error,
          totalCost: context.totalCost,
        });
      },
    })
    .catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Job ${jobId} queue error`, { error: errorMessage });
    });
};

export const createRoutes = (rateLimiter: ServerRateLimiter): Router => {
  const router = createRouter();
  router.post('/queue-job', createQueueJobHandler(rateLimiter));
  return router;
};
