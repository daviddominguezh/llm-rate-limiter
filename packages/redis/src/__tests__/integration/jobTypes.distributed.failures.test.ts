/**
 * Distributed job types failure scenario tests for Redis backend.
 * Verifies graceful handling of various failure scenarios.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  MEDIUM_DELAY_MS,
  SMALL_CAPACITY_TEN,
  createTestBackend,
  createTestState,
  delay,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
} from './testSetup.js';

const state = createTestState();
const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const HUNDRED = 100;
const DEFAULT_TIMEOUT = 30000;

const SINGLE_TYPE_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
};

/** Helper to acquire N slots sequentially */
const acquireSlots = async (
  backend: ReturnType<typeof createTestBackend>,
  instanceId: string,
  jobType: string,
  count: number
): Promise<number> => {
  let acquired = ZERO;
  for (let i = ZERO; i < count; i += ONE) {
    // eslint-disable-next-line no-await-in-loop -- Sequential acquire needed to test slot counting
    if (await backend.acquireJobType(instanceId, jobType)) {
      acquired += ONE;
    }
  }
  return acquired;
};

/** Helper to release N slots sequentially */
const releaseSlots = async (
  backend: ReturnType<typeof createTestBackend>,
  instanceId: string,
  jobType: string,
  count: number
): Promise<void> => {
  for (let i = ZERO; i < count; i += ONE) {
    // eslint-disable-next-line no-await-in-loop -- Sequential release needed to test slot counting
    await backend.releaseJobType(instanceId, jobType);
  }
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

describe('Redis Distributed Failures - Instance Disconnect', () => {
  it('should handle instance disconnect without affecting other instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });

    try {
      // Both instances acquire slots
      await backend1.acquireJobType('inst1', 'typeA');
      await backend1.acquireJobType('inst1', 'typeA');
      await backend2.acquireJobType('inst2', 'typeA');

      // Instance 1 stops (simulates disconnect)
      await backend1.stop();

      // Instance 2 should still work
      const acquired = await backend2.acquireJobType('inst2', 'typeA');
      expect(acquired).toBe(true);

      const stats = await backend2.getJobTypeStats();
      // Note: The slots from inst1 are still counted as in-flight in Redis
      // until they're explicitly released or TTL expires
      expect(stats?.jobTypes.typeA?.totalInFlight).toBeGreaterThan(ZERO);
    } finally {
      await backend2.stop();
    }
  });
});

describe('Redis Distributed Failures - Release After Stop', () => {
  it('should handle release calls after backend stop gracefully', async () => {
    if (!state.redisAvailable) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });

    // Acquire a slot
    await backend.acquireJobType('inst1', 'typeA');

    // Stop the backend
    await backend.stop();

    // Release after stop should not throw
    await expect(backend.releaseJobType('inst1', 'typeA')).resolves.not.toThrow();
  });
});

describe('Redis Distributed Failures - Multiple Stop Calls', () => {
  it('should handle multiple stop calls idempotently', async () => {
    if (!state.redisAvailable) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });

    await backend.acquireJobType('inst1', 'typeA');

    // Multiple stops should not throw
    await expect(backend.stop()).resolves.not.toThrow();
    await expect(backend.stop()).resolves.not.toThrow();
    await expect(backend.stop()).resolves.not.toThrow();
  });
});

describe('Redis Distributed Failures - Slot Release And Reacquire', () => {
  it(
    'should allow new instance to acquire slots released by first instance',
    async () => {
      if (!state.redisAvailable) return;

      const backend1 = createTestBackend(state, createRedisBackend, {
        capacity: SMALL_CAPACITY_TEN,
        resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
      });
      const backend2 = createTestBackend(state, createRedisBackend, {
        capacity: SMALL_CAPACITY_TEN,
        resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
      });

      try {
        // Instance 1 acquires all slots
        await acquireSlots(backend1, 'inst1', 'typeA', TEN);

        // Verify all slots used
        const statsBefore = await backend1.getJobTypeStats();
        expect(statsBefore?.jobTypes.typeA?.totalInFlight).toBe(TEN);

        // Instance 2 cannot acquire (all slots taken)
        expect(await backend2.acquireJobType('inst2', 'typeA')).toBe(false);

        // Instance 1 releases some slots
        await releaseSlots(backend1, 'inst1', 'typeA', FIVE);

        // Verify stats show 5 in-flight (remaining from inst1)
        const statsAfterRelease = await backend1.getJobTypeStats();
        expect(statsAfterRelease?.jobTypes.typeA?.totalInFlight).toBe(FIVE);

        // Now instance 2 should be able to acquire the released slots
        const acquired = await acquireSlots(backend2, 'inst2', 'typeA', TEN);

        // Should acquire exactly 5 (the released ones)
        expect(acquired).toBe(FIVE);

        // Total should now be 10
        const finalStats = await backend2.getJobTypeStats();
        expect(finalStats?.jobTypes.typeA?.totalInFlight).toBe(TEN);
      } finally {
        await backend1.stop();
        await backend2.stop();
      }
    },
    DEFAULT_TIMEOUT
  );
});

describe('Redis Distributed Failures - Concurrent Operations During Disconnect', () => {
  it('should handle ongoing operations when instance disconnects', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });

    try {
      // Start concurrent operations
      const operations: Array<Promise<boolean>> = [];

      for (let i = ZERO; i < TEN; i += ONE) {
        operations.push(
          (async (): Promise<boolean> => {
            const acquired = await backend1.acquireJobType('inst1', 'typeA');
            if (acquired) {
              await delay(MEDIUM_DELAY_MS);
              await backend1.releaseJobType('inst1', 'typeA');
            }
            return acquired;
          })()
        );
      }

      // While operations are running, backend2 also tries to operate
      operations.push(backend2.acquireJobType('inst2', 'typeA'));

      // Should complete without errors
      await expect(Promise.all(operations)).resolves.toBeDefined();

      // Final state should be consistent
      const stats = await backend2.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.totalInFlight).toBeGreaterThanOrEqual(ZERO);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

const TWO = 2;
const THREE = 3;
const FOUR = 4;

describe('Redis Distributed Failures - Stats After Operations', () => {
  it('should maintain accurate stats after mixed operations', async () => {
    if (!state.redisAvailable) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: SINGLE_TYPE_CONFIG,
    });

    try {
      // Acquire 5
      await acquireSlots(backend, 'inst1', 'typeA', FIVE);

      // Release 3
      await releaseSlots(backend, 'inst1', 'typeA', THREE);

      // Acquire 2 more
      await acquireSlots(backend, 'inst1', 'typeA', TWO);

      // Stats should reflect: 5 - 3 + 2 = 4
      const stats = await backend.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.totalInFlight).toBe(FOUR);
    } finally {
      await backend.stop();
    }
  });
});
