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

const queueJobToLimiter = (params: QueueJobToLimiterParams): void => {
  const { rateLimiter, jobId, jobType, payload } = params;

  rateLimiter
    .queueJob({
      jobId,
      jobType,
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

  router.post('/queue-job', (req: Request, res: Response<QueueJobResponse | ErrorResponse>): void => {
    const validation = validateQueueJobRequest(req.body);

    if (!validation.valid) {
      res.status(HTTP_STATUS_BAD_REQUEST).json({ error: validation.error });
      return;
    }

    const { data } = validation;

    queueJobToLimiter({ ...data, rateLimiter });

    res.status(HTTP_STATUS_ACCEPTED).json({ jobId: data.jobId });
  });

  return router;
};
