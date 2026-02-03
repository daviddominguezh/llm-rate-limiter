/**
 * Redis backend factory for the LLM Rate Limiter.
 *
 * Provides a clean API where the backend receives rate limiter config
 * automatically during initialization - no user duplication needed.
 */
import { Redis as RedisClient } from 'ioredis';

import { DEFAULT_FACTORY_KEY_PREFIX, ZERO } from './constants.js';
import { createRedisBackend as createRedisBackendLegacy } from './redisBackend.js';
import type {
  RedisBackendConfig,
  RedisBackendFactory,
  RedisBackendInitConfig,
  RedisBackendInstance,
  RedisBackendUserConfig,
} from './types.js';

/** Parse user config - accepts either a URL string or a config object */
const parseUserConfig = (config: string | RedisBackendUserConfig): RedisBackendUserConfig => {
  if (typeof config === 'string') {
    return { url: config };
  }
  return config;
};

/**
 * Calculate total capacity across all models.
 * Uses maxConcurrentRequests if available, otherwise sums up a default per model.
 */
const calculateTotalCapacity = (models: RedisBackendInitConfig['models']): number => {
  let totalCapacity = ZERO;
  const defaultCapacityPerModel = 100;
  for (const modelConfig of Object.values(models)) {
    const { maxConcurrentRequests } = modelConfig;
    totalCapacity += maxConcurrentRequests ?? defaultCapacityPerModel;
  }
  return totalCapacity;
};

/**
 * Calculate total tokens per minute across all models.
 */
const calculateTotalTokensPerMinute = (models: RedisBackendInitConfig['models']): number => {
  let totalTokens = ZERO;
  for (const modelConfig of Object.values(models)) {
    const { tokensPerMinute } = modelConfig;
    if (tokensPerMinute !== undefined) {
      totalTokens += tokensPerMinute;
    }
  }
  return totalTokens;
};

/**
 * Calculate total requests per minute across all models.
 */
const calculateTotalRequestsPerMinute = (models: RedisBackendInitConfig['models']): number => {
  let totalRequests = ZERO;
  for (const modelConfig of Object.values(models)) {
    const { requestsPerMinute } = modelConfig;
    if (requestsPerMinute !== undefined) {
      totalRequests += requestsPerMinute;
    }
  }
  return totalRequests;
};

/**
 * Build backend config from user config and rate limiter init config.
 */
const buildBackendConfig = (
  userConfig: RedisBackendUserConfig,
  config: RedisBackendInitConfig
): RedisBackendConfig => {
  const { models, resourcesPerJob } = config;
  const totalCapacity = calculateTotalCapacity(models);
  const tokensPerMinute = calculateTotalTokensPerMinute(models);
  const requestsPerMinute = calculateTotalRequestsPerMinute(models);

  return {
    redis: new RedisClient(userConfig.url),
    totalCapacity,
    tokensPerMinute: tokensPerMinute > ZERO ? tokensPerMinute : undefined,
    requestsPerMinute: requestsPerMinute > ZERO ? requestsPerMinute : undefined,
    keyPrefix: userConfig.keyPrefix ?? DEFAULT_FACTORY_KEY_PREFIX,
    heartbeatIntervalMs: userConfig.heartbeatIntervalMs,
    instanceTimeoutMs: userConfig.instanceTimeoutMs,
    resourcesPerJob,
  };
};

/**
 * Create a Redis distributed backend (new clean API).
 *
 * This factory approach eliminates data duplication - users only need to configure
 * models and resourcesPerJob once in the rate limiter config, and the Redis backend
 * receives this configuration automatically during initialization.
 *
 * @param config - Redis URL string or configuration object
 *
 * @example
 * ```typescript
 * // Simple: just pass the URL
 * const limiter = createLLMRateLimiter({
 *   models,
 *   order: modelOrder,
 *   resourcesPerJob,
 *   backend: createRedisBackend('redis://localhost:6379'),
 * });
 *
 * // With options
 * const limiter = createLLMRateLimiter({
 *   models,
 *   backend: createRedisBackend({
 *     url: 'redis://localhost:6379',
 *     keyPrefix: 'my-app:',
 *   }),
 * });
 * ```
 */
export const createRedisBackend = (config: string | RedisBackendUserConfig): RedisBackendFactory => {
  const userConfig = parseUserConfig(config);
  let instance: RedisBackendInstance | null = null;

  const initialize = async (initConfig: RedisBackendInitConfig): Promise<RedisBackendInstance> => {
    if (instance !== null) {
      return await Promise.resolve(instance);
    }

    const backendConfig = buildBackendConfig(userConfig, initConfig);
    instance = createRedisBackendLegacy(backendConfig);
    return await Promise.resolve(instance);
  };

  const isInitialized = (): boolean => instance !== null;

  const getInstance = (): RedisBackendInstance => {
    if (instance === null) {
      throw new Error('Redis backend factory not initialized. Call initialize() first.');
    }
    return instance;
  };

  return {
    initialize,
    isInitialized,
    getInstance,
  };
};
