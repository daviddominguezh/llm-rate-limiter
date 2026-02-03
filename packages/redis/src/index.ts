/**
 * Redis distributed backend for the LLM Rate Limiter.
 *
 * This module provides a ready-to-use distributed backend that implements
 * the V2 DistributedBackendConfig interface with fair slot distribution.
 *
 * @example
 * ```typescript
 * import { createLLMRateLimiter } from '@llm-rate-limiter/core';
 * import { createRedisBackendFactory } from '@llm-rate-limiter/redis';
 *
 * // Create rate limiter with Redis backend (clean API - no duplication)
 * const limiter = createLLMRateLimiter({
 *   models: {
 *     'gpt-4': {
 *       requestsPerMinute: 500,
 *       tokensPerMinute: 100000,
 *       pricing: { input: 0.03, output: 0.06, cached: 0.015 },
 *     },
 *   },
 *   resourcesPerJob: {
 *     'summarize': { estimatedUsedTokens: 5000, ratio: { initialValue: 0.6 } },
 *     'translate': { estimatedUsedTokens: 2000, ratio: { initialValue: 0.4 } },
 *   },
 *   // Backend gets models and resourcesPerJob automatically from rate limiter
 *   backend: createRedisBackendFactory({
 *     url: 'redis://localhost:6379',
 *     keyPrefix: 'my-app:',
 *   }),
 * });
 *
 * // Start (registers with Redis and initializes backend)
 * await limiter.start();
 *
 * // Use normally...
 *
 * // Stop (unregisters from Redis)
 * limiter.stop();
 * ```
 *
 * @packageDocumentation
 */

// New clean API - use this!
export { createRedisBackend } from './redisBackendFactory.js';
// Legacy API for explicit config (backward compatibility)
export { createRedisBackend as createRedisBackendLegacy } from './redisBackend.js';
export type {
  RedisBackendConfig,
  RedisBackendFactory,
  RedisBackendInitConfig,
  RedisBackendInstance,
  RedisBackendStats,
  RedisBackendUserConfig,
  RedisConnectionOptions,
  RedisInstanceStats,
} from './types.js';
export { isRedisBackendFactory } from './types.js';
