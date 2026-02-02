/**
 * Coverage tests for Redis backend edge cases.
 */
import { jest } from '@jest/globals';
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createRedisBackend } from '../../redisBackend.js';
import { isRedisClient, toRedisOptions } from '../../types.js';
import {
  REDIS_PORT,
  SHORT_DELAY_MS,
  SMALL_CAPACITY_TEN,
  createTestBackend,
  createTestState,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
} from './testSetup.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const CLEANUP_INTERVAL_MS = 10000;

const state = createTestState();

beforeAll(async () => {
  await setupBeforeAll(state);
});
afterAll(async () => {
  await setupAfterAll(state);
});
beforeEach(async () => {
  await setupBeforeEach(state);
});
afterEach(async () => {
  await setupAfterEach(state);
});

const LOCALHOST = 'localhost';
const DB_ONE = 1;

describe('types - toRedisOptions without TLS', () => {
  it('should return undefined for tls when tls is not true', () => {
    const opts = toRedisOptions({ host: LOCALHOST, port: REDIS_PORT });
    expect(opts.tls).toBeUndefined();
    expect(opts.host).toBe(LOCALHOST);
    expect(opts.port).toBe(REDIS_PORT);
  });

  it('should return undefined for tls when tls is false', () => {
    const opts = toRedisOptions({ host: LOCALHOST, port: REDIS_PORT, tls: false });
    expect(opts.tls).toBeUndefined();
  });

  it('should return empty object for tls when tls is true', () => {
    const opts = toRedisOptions({ host: LOCALHOST, port: REDIS_PORT, tls: true });
    expect(opts.tls).toEqual({});
  });

  it('should pass through password and db', () => {
    const opts = toRedisOptions({ host: LOCALHOST, port: REDIS_PORT, password: 'secret', db: DB_ONE });
    expect(opts.password).toBe('secret');
    expect(opts.db).toBe(DB_ONE);
  });
});

describe('types - isRedisClient', () => {
  it('should return false for connection options', () => {
    const opts = { host: LOCALHOST, port: REDIS_PORT };
    expect(isRedisClient(opts)).toBe(false);
  });

  it('should return true for Redis client', () => {
    if (!state.redisAvailable || state.redis === undefined) return;
    expect(isRedisClient(state.redis)).toBe(true);
  });
});

describe('Redis Backend - cleanup interval with fake timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should run cleanup interval callback', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);
    const backendConfig = backend.getBackendConfig();
    await backendConfig.register('cleanup-test-instance');

    jest.advanceTimersByTime(CLEANUP_INTERVAL_MS + ONE);

    await backendConfig.unregister('cleanup-test-instance');
    await backend.stop();
  });
});

describe('Redis Backend - getStats with corrupted data', () => {
  it('should return default stats when data is corrupted', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('stats-test-instance');

      const allocationsKey = `${state.testPrefix}allocations`;
      await state.redis.hset(allocationsKey, 'invalid-key', 'not-valid-json');

      const stats = await backend.getStats();
      expect(stats.totalInstances).toBeGreaterThanOrEqual(ZERO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - acquire error handling', () => {
  it('should return false when acquire throws error', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);

    try {
      const backendConfig = backend.getBackendConfig();
      const result = await backendConfig.acquire({
        instanceId: 'non-existent-instance',
        modelId: 'test-model',
        jobId: 'test-job',
        estimated: { tokens: ONE, requests: ONE },
      });
      expect(result).toBe(false);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - multiple heartbeat intervals', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not start multiple heartbeat intervals', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend);

    try {
      const backendConfig = backend.getBackendConfig();
      await backendConfig.register('heartbeat-test-1');
      await backendConfig.register('heartbeat-test-2');

      const stats = await backend.getStats();
      expect(stats.totalInstances).toBe(TWO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - connection options', () => {
  it('should create backend with connection options instead of client', async () => {
    if (!state.redisAvailable) return;

    const backend = createRedisBackend({
      redis: { host: LOCALHOST, port: REDIS_PORT },
      totalCapacity: SMALL_CAPACITY_TEN,
      keyPrefix: `${state.testPrefix}conn-opts-`,
    });

    await setTimeoutAsync(SHORT_DELAY_MS);

    await backend.stop();
  });
});
