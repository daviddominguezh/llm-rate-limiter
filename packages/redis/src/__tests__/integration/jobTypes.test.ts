/**
 * Job type integration tests for Redis distributed backend.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  SMALL_CAPACITY_TEN,
  createTestBackend,
  createTestState,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
} from './testSetup.js';

const state = createTestState();
const RATIO_06 = 0.6;
const RATIO_04 = 0.4;
const EXPECTED_JOB1_SLOTS = 6;
const EXPECTED_JOB2_SLOTS = 4;
const INSTANCE_ID = 'instance-1';
const ZERO = 0;
const ONE = 1;

const JOB_TYPES_CONFIG = {
  job1: { estimatedUsedTokens: EXPECTED_JOB1_SLOTS, ratio: { initialValue: RATIO_06 } },
  job2: { estimatedUsedTokens: EXPECTED_JOB2_SLOTS, ratio: { initialValue: RATIO_04 } },
};

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

describe('Redis Backend - Job Types Stats', () => {
  it('should return job type stats with allocated slots', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: JOB_TYPES_CONFIG,
    });

    try {
      const stats = await backend.getJobTypeStats();
      expect(stats?.jobTypes.job1?.allocatedSlots).toBe(EXPECTED_JOB1_SLOTS);
      expect(stats?.jobTypes.job2?.allocatedSlots).toBe(EXPECTED_JOB2_SLOTS);
    } finally {
      await backend.stop();
    }
  });

  it('should return undefined when no resourcesPerJob configured', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, { capacity: SMALL_CAPACITY_TEN });

    try {
      expect(await backend.getJobTypeStats()).toBeUndefined();
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Job Type Acquire Success', () => {
  it('should acquire and track in-flight count', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: JOB_TYPES_CONFIG,
    });

    try {
      expect(await backend.acquireJobType(INSTANCE_ID, 'job1')).toBe(true);
      const stats = await backend.getJobTypeStats();
      expect(stats?.jobTypes.job1?.totalInFlight).toBe(ONE);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Job Type Acquire Failures', () => {
  it('should return false for unknown job type', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: { job1: { estimatedUsedTokens: EXPECTED_JOB1_SLOTS } },
    });

    try {
      expect(await backend.acquireJobType(INSTANCE_ID, 'unknown')).toBe(false);
    } finally {
      await backend.stop();
    }
  });

  it('should return false when no resourcesPerJob configured', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, { capacity: SMALL_CAPACITY_TEN });

    try {
      expect(await backend.acquireJobType(INSTANCE_ID, 'job1')).toBe(false);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Job Type Release', () => {
  it('should decrement in-flight count on release', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: JOB_TYPES_CONFIG,
    });

    try {
      await backend.acquireJobType(INSTANCE_ID, 'job1');
      await backend.releaseJobType(INSTANCE_ID, 'job1');
      const stats = await backend.getJobTypeStats();
      expect(stats?.jobTypes.job1?.totalInFlight).toBe(ZERO);
    } finally {
      await backend.stop();
    }
  });
});

describe('Redis Backend - Job Type Capacity', () => {
  it('should fail acquire when at capacity', async () => {
    if (!state.redisAvailable || state.redis === undefined) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: {
        job1: { estimatedUsedTokens: EXPECTED_JOB1_SLOTS, ratio: { initialValue: RATIO_06 } },
      },
    });

    try {
      // Acquire all 6 slots
      const promises = Array.from(
        { length: EXPECTED_JOB1_SLOTS },
        async () => await backend.acquireJobType(INSTANCE_ID, 'job1')
      );
      await Promise.all(promises);
      // Next should fail
      expect(await backend.acquireJobType(INSTANCE_ID, 'job1')).toBe(false);
    } finally {
      await backend.stop();
    }
  });
});
