import { type LLMRateLimiterInstance, createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

import {
  DEFAULT_ESTIMATED_REQUESTS,
  DEFAULT_ESTIMATED_TOKENS,
  DEFAULT_JOB_TYPE_RATIO,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  DEFAULT_PRICING_CACHED,
  DEFAULT_PRICING_INPUT,
  DEFAULT_PRICING_OUTPUT,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_TOKENS_PER_MINUTE,
} from './constants.js';
import { logger } from './logger.js';

const models = {
  'default-model': {
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    tokensPerMinute: DEFAULT_TOKENS_PER_MINUTE,
    maxConcurrentRequests: DEFAULT_MAX_CONCURRENT_REQUESTS,
    pricing: {
      input: DEFAULT_PRICING_INPUT,
      output: DEFAULT_PRICING_OUTPUT,
      cached: DEFAULT_PRICING_CACHED,
    },
  },
};

const resourceEstimationsPerJob = {
  default: {
    estimatedUsedTokens: DEFAULT_ESTIMATED_TOKENS,
    estimatedNumberOfRequests: DEFAULT_ESTIMATED_REQUESTS,
    ratio: { initialValue: DEFAULT_JOB_TYPE_RATIO },
  },
};

export const createRateLimiterInstance = (redisUrl: string): LLMRateLimiterInstance<'default'> => {
  const limiter = createLLMRateLimiter({
    models,
    resourceEstimationsPerJob,
    backend: createRedisBackend(redisUrl),
    onLog: (message, data) => logger.info(message, data),
  });

  return limiter;
};

export type ServerRateLimiter = LLMRateLimiterInstance<'default'>;
