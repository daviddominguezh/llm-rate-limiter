/**
 * Shared test setup and helpers for Redis integration tests.
 */
import type {
  BackendAcquireContext,
  BackendReleaseContext,
  ResourceEstimationsPerJob,
} from '@llm-rate-limiter/core';
import { Redis } from 'ioredis';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import type { RedisBackendConfig, RedisBackendInstance } from '../../types.js';

/** Test configuration constants */
export const TEST_KEY_PREFIX = 'test-llm-rl:';
export const TOTAL_CAPACITY = 100;
export const TOKENS_PER_MINUTE = 10000;
export const REQUESTS_PER_MINUTE = 1000;
export const REDIS_PORT = 6379;

/** Get Redis connection options from REDIS_URL env var or default to localhost */
const getRedisOptions = (): string | { host: string; port: number } => {
  const { env } = process;
  const { REDIS_URL } = env;
  if (REDIS_URL !== undefined && REDIS_URL !== '') {
    return REDIS_URL;
  }
  return { host: 'localhost', port: REDIS_PORT };
};
export const SMALL_CAPACITY = 2;
export const SMALL_CAPACITY_TEN = 10;
export const SMALL_CAPACITY_FIVE = 5;
export const HALF_CAPACITY = 50;
export const SHORT_DELAY_MS = 50;
export const MEDIUM_DELAY_MS = 100;
export const LONG_DELAY_MS = 200;
export const RANDOM_SLICE_START = 2;
export const RADIX_BASE = 36;
export const ESTIMATED_TOKENS = 100;
export const ESTIMATED_REQUESTS = 1;
export const EXPECTED_INSTANCES_ONE = 1;
export const EXPECTED_INSTANCES_TWO = 2;
export const EXPECTED_IN_FLIGHT_ZERO = 0;
export const EXPECTED_IN_FLIGHT_ONE = 1;
export const EXPECTED_IN_FLIGHT_TWO = 2;
export const MIN_ALLOCATIONS_COUNT = 1;
export const FIRST_INDEX = 0;

/** Small delay for async operations using promisified setTimeout */
export const delay = async (ms: number): Promise<void> => {
  await setTimeoutAsync(ms);
};

/** Default job type for testing */
export const DEFAULT_JOB_TYPE = 'test-job-type';

/** Create acquire context for testing */
export const acquireCtx = (
  instanceId: string,
  jobId = 'test-job',
  jobType = DEFAULT_JOB_TYPE
): BackendAcquireContext => ({
  instanceId,
  modelId: 'test-model',
  jobId,
  jobType,
  estimated: { tokens: ESTIMATED_TOKENS, requests: ESTIMATED_REQUESTS },
});

/** Create release context for testing */
export const releaseCtx = (
  instanceId: string,
  jobId = 'test-job',
  jobType = DEFAULT_JOB_TYPE
): BackendReleaseContext => ({
  instanceId,
  modelId: 'test-model',
  jobId,
  jobType,
  estimated: { tokens: ESTIMATED_TOKENS, requests: ESTIMATED_REQUESTS },
  actual: { tokens: ESTIMATED_TOKENS, requests: ESTIMATED_REQUESTS },
});

/** Default keepalive for test connections */
const TEST_KEEPALIVE_MS = 30000;

/** Check if Redis is available */
export const checkRedisAvailable = async (): Promise<boolean> => {
  const options = getRedisOptions();
  const testRedis =
    typeof options === 'string'
      ? new Redis(options, { lazyConnect: true, keepAlive: TEST_KEEPALIVE_MS })
      : new Redis({ ...options, lazyConnect: true, keepAlive: TEST_KEEPALIVE_MS });
  try {
    await testRedis.connect();
    await testRedis.ping();
    await testRedis.quit();
    return true;
  } catch {
    return false;
  }
};

/** Clean up test keys from Redis */
export const cleanupTestKeys = async (redisClient: Redis, prefix: string): Promise<void> => {
  const keys = await redisClient.keys(`${prefix}*`);
  if (keys.length > EXPECTED_IN_FLIGHT_ZERO) {
    await redisClient.del(...keys);
  }
};

/** Test state interface */
export interface TestState {
  redisAvailable: boolean;
  redis: Redis | undefined;
  testPrefix: string;
}

/** Create shared test state */
export const createTestState = (): TestState => ({
  redisAvailable: false,
  redis: undefined,
  testPrefix: '',
});

/** Setup common beforeAll hook - modifies state object properties */
export const setupBeforeAll = async (stateRef: TestState): Promise<void> => {
  const available = await checkRedisAvailable();
  Object.assign(stateRef, { redisAvailable: available });
  if (available) {
    const options = getRedisOptions();
    const redis =
      typeof options === 'string'
        ? new Redis(options, { keepAlive: TEST_KEEPALIVE_MS })
        : new Redis({ ...options, keepAlive: TEST_KEEPALIVE_MS });
    Object.assign(stateRef, { redis });
  }
};

/** Setup common afterAll hook */
export const setupAfterAll = async (stateRef: TestState): Promise<void> => {
  if (stateRef.redisAvailable && stateRef.redis !== undefined) {
    await stateRef.redis.quit();
  }
};

/** Setup common beforeEach hook - modifies state object properties */
export const setupBeforeEach = async (stateRef: TestState): Promise<void> => {
  if (!stateRef.redisAvailable || stateRef.redis === undefined) return;
  const prefix = `${TEST_KEY_PREFIX}${Date.now()}-${Math.random().toString(RADIX_BASE).slice(RANDOM_SLICE_START)}:`;
  Object.assign(stateRef, { testPrefix: prefix });
  await cleanupTestKeys(stateRef.redis, prefix);
};

/** Setup common afterEach hook */
export const setupAfterEach = async (stateRef: TestState): Promise<void> => {
  if (!stateRef.redisAvailable || stateRef.redis === undefined) return;
  await cleanupTestKeys(stateRef.redis, stateRef.testPrefix);
};

/** Backend configuration options */
export interface BackendOptions {
  capacity?: number;
  tokensPerMinute?: number;
  requestsPerMinute?: number;
  resourceEstimationsPerJob?: ResourceEstimationsPerJob;
}

/** Function type for creating Redis backends */
type CreateRedisBackendFn = (config: RedisBackendConfig) => RedisBackendInstance;

/** Create a backend with standard test configuration */
export const createTestBackend = (
  stateRef: TestState,
  createFn: CreateRedisBackendFn,
  options: BackendOptions = {}
): RedisBackendInstance => {
  if (stateRef.redis === undefined) {
    throw new Error('Redis not available');
  }
  return createFn({
    redis: stateRef.redis,
    totalCapacity: options.capacity ?? TOTAL_CAPACITY,
    tokensPerMinute: options.tokensPerMinute,
    requestsPerMinute: options.requestsPerMinute,
    keyPrefix: stateRef.testPrefix,
    resourceEstimationsPerJob: options.resourceEstimationsPerJob,
  });
};
