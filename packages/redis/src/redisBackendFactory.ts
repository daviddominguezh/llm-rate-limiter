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
 * Build backend config from user config, rate limiter init config, and pre-created Redis client.
 */
const buildBackendConfigWithClient = (
  userConfig: RedisBackendUserConfig,
  config: RedisBackendInitConfig,
  redisClient: RedisClient
): RedisBackendConfig => {
  const { models, resourceEstimationsPerJob } = config;
  const totalCapacity = calculateTotalCapacity(models);
  const tokensPerMinute = calculateTotalTokensPerMinute(models);
  const requestsPerMinute = calculateTotalRequestsPerMinute(models);

  return {
    redis: redisClient,
    totalCapacity,
    tokensPerMinute: tokensPerMinute > ZERO ? tokensPerMinute : undefined,
    requestsPerMinute: requestsPerMinute > ZERO ? requestsPerMinute : undefined,
    keyPrefix: userConfig.keyPrefix ?? DEFAULT_FACTORY_KEY_PREFIX,
    heartbeatIntervalMs: userConfig.heartbeatIntervalMs,
    instanceTimeoutMs: userConfig.instanceTimeoutMs,
    resourceEstimationsPerJob,
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
 *   escalationOrder: modelOrder,
 *   resourcesPerJob,
 *   backend: createRedisBackend('redis://localhost:6379'),
 * });
 *
 * // With options
 * const limiter = createLLMRateLimiter({
 *   models,
 *   escalationOrder: modelOrder,
 *   resourcesPerJob,
 *   backend: createRedisBackend({
 *     url: 'redis://localhost:6379',
 *     keyPrefix: 'my-app:',
 *   }),
 * });
 * ```
 */
/** Factory state for tracking instances and cleanup */
interface FactoryState {
  instance: RedisBackendInstance | null;
  redisClient: RedisClient | null;
  stopPromise: Promise<void> | null;
}

/** Perform stop cleanup on factory state */
const performFactoryStop = async (state: FactoryState): Promise<void> => {
  if (state.instance !== null) {
    await state.instance.stop();
  }
  if (state.redisClient !== null) {
    await state.redisClient.quit();
  }
};

export const createRedisBackend = (config: string | RedisBackendUserConfig): RedisBackendFactory => {
  const userConfig = parseUserConfig(config);
  const state: FactoryState = { instance: null, redisClient: null, stopPromise: null };

  const initialize = async (initConfig: RedisBackendInitConfig): Promise<RedisBackendInstance> => {
    if (state.instance !== null) {
      return await Promise.resolve(state.instance);
    }
    state.redisClient = new RedisClient(userConfig.url);
    const backendConfig = buildBackendConfigWithClient(userConfig, initConfig, state.redisClient);
    state.instance = createRedisBackendLegacy(backendConfig);
    return await Promise.resolve(state.instance);
  };

  const isInitialized = (): boolean => state.instance !== null;

  const getInstance = (): RedisBackendInstance => {
    if (state.instance === null) {
      throw new Error('Redis backend factory not initialized. Call initialize() first.');
    }
    return state.instance;
  };

  const stop = async (): Promise<void> => {
    if (state.stopPromise !== null) {
      await state.stopPromise;
      return;
    }
    state.stopPromise = performFactoryStop(state);
    await state.stopPromise;
  };

  return { initialize, isInitialized, getInstance, stop };
};
