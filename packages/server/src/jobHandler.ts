import type { JobResult } from '@llm-rate-limiter/core';

import {
  MOCK_INPUT_TOKENS,
  MOCK_OUTPUT_TOKENS,
  MOCK_REQUEST_COUNT,
  ZERO_CACHED_TOKENS,
} from './constants.js';
import { logger } from './logger.js';

interface JobData {
  processed: boolean;
  jobId: string;
  jobType: string;
}

interface ProcessJobParams {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  modelId: string;
}

interface JobCompletionParams {
  jobId: string;
  modelUsed: string;
  totalCost: number;
}

interface JobErrorParams {
  jobId: string;
  error: Error;
  totalCost: number;
}

export const processJob = (params: ProcessJobParams): JobResult<JobData> => {
  const { jobId, jobType, payload, modelId } = params;

  logger.info(`Processing job ${jobId}`, { modelId, jobType, payload });

  return {
    inputTokens: MOCK_INPUT_TOKENS,
    cachedTokens: ZERO_CACHED_TOKENS,
    outputTokens: MOCK_OUTPUT_TOKENS,
    requestCount: MOCK_REQUEST_COUNT,
    data: { processed: true, jobId, jobType },
  };
};

export const handleJobComplete = (params: JobCompletionParams): void => {
  const { jobId, modelUsed, totalCost } = params;
  logger.info(`Job ${jobId} completed`, { modelUsed, totalCost });
};

export const handleJobError = (params: JobErrorParams): void => {
  const { jobId, error, totalCost } = params;
  logger.error(`Job ${jobId} failed`, { error: error.message, totalCost });
};
