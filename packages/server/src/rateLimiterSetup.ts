import { type LLMRateLimiterInstance, createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

import { logger } from './logger.js';
import { ESCALATION_ORDER, MODELS, RESOURCE_ESTIMATIONS } from './rateLimiterConfig.js';

export const createRateLimiterInstance = (redisUrl: string): LLMRateLimiterInstance<string> =>
  createLLMRateLimiter({
    models: MODELS,
    escalationOrder: ESCALATION_ORDER,
    resourceEstimationsPerJob: RESOURCE_ESTIMATIONS,
    backend: createRedisBackend(redisUrl),
    onLog: (message, data) => logger.info(message, data),
  });

export type ServerRateLimiter = LLMRateLimiterInstance<string>;
