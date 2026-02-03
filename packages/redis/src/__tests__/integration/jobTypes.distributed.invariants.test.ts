/**
 * Distributed job types invariant tests for Redis backend.
 * Verifies that critical invariants are maintained across multiple instances.
 */
import { createRedisBackend } from '../../redisBackend.js';
import {
  SHORT_DELAY_MS,
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
const TWO = 2;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const HUNDRED = 100;
const MEDIUM_CAPACITY = 50;
const RATIO_HALF = 0.5;
const RATIO_04 = 0.4;
const RATIO_03 = 0.3;

const TWO_TYPES_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
  typeB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
};

const THREE_TYPES_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
  typeB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
  typeC: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
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

describe('Redis Distributed Invariants - Atomic Acquire Race', () => {
  it('should handle concurrent acquire race from multiple instances atomically', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: {
        singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: {
        singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });
    const backend3 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: {
        singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } },
      },
    });

    try {
      // Race condition: all instances try to acquire at the same time
      const promises: Array<Promise<boolean>> = [];
      for (let i = ZERO; i < TWENTY; i += ONE) {
        promises.push(backend1.acquireJobType('inst1', 'singleType'));
        promises.push(backend2.acquireJobType('inst2', 'singleType'));
        promises.push(backend3.acquireJobType('inst3', 'singleType'));
      }

      const results = await Promise.all(promises);
      const successfulResults = results.filter((r) => r);

      // Exactly 10 should succeed (total capacity)
      expect(successfulResults).toHaveLength(TEN);

      // Verify stats show exactly 10 in-flight
      const stats = await backend1.getJobTypeStats();
      expect(stats?.jobTypes.singleType?.totalInFlight).toBe(TEN);
    } finally {
      await backend1.stop();
      await backend2.stop();
      await backend3.stop();
    }
  });
});

describe('Redis Distributed Invariants - Rapid Cycles', () => {
  it('should handle rapid acquire/release cycles across instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: TWO_TYPES_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: TWO_TYPES_CONFIG,
    });

    try {
      const operations: Array<Promise<void>> = [];

      // Rapid acquire/release from both instances
      for (let i = ZERO; i < TWENTY; i += ONE) {
        const jobType = i % TWO === ZERO ? 'typeA' : 'typeB';
        const backend = i % TWO === ZERO ? backend1 : backend2;
        const instanceId = i % TWO === ZERO ? 'inst1' : 'inst2';

        operations.push(
          (async (): Promise<void> => {
            const acquired = await backend.acquireJobType(instanceId, jobType);
            if (acquired) {
              await delay(SHORT_DELAY_MS);
              await backend.releaseJobType(instanceId, jobType);
            }
          })()
        );
      }

      await Promise.all(operations);

      // After all operations, inFlight should be 0 for both types
      const stats = await backend1.getJobTypeStats();
      expect(stats?.jobTypes.typeA?.totalInFlight).toBe(ZERO);
      expect(stats?.jobTypes.typeB?.totalInFlight).toBe(ZERO);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

/** Backend configuration type */
type BackendConfig = Parameters<typeof createTestBackend>[typeof TWO];

/** Helper to create multiple backends with the same config */
const createBackends = (count: number, config: BackendConfig): Array<ReturnType<typeof createTestBackend>> =>
  Array.from({ length: count }, () => createTestBackend(state, createRedisBackend, config));

/** Helper to stop all backends */
const stopBackends = async (backends: Array<ReturnType<typeof createTestBackend>>): Promise<void> => {
  await Promise.all(
    backends.map(async (b) => {
      await b.stop();
    })
  );
};

/** Helper to verify consistent stats for a job type across all backends */
const verifyConsistentStats = (
  allStats: Array<Awaited<ReturnType<ReturnType<typeof createTestBackend>['getJobTypeStats']>>>,
  jobType: string,
  expectedInFlight: number
): void => {
  for (const stats of allStats) {
    expect(stats?.jobTypes[jobType]?.totalInFlight).toBe(expectedInFlight);
  }
};

describe('Redis Distributed Invariants - Consistent Stats', () => {
  it('should maintain consistent stats view across all instances', async () => {
    if (!state.redisAvailable) return;

    const THREE = 3;
    const backends = createBackends(THREE, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: THREE_TYPES_CONFIG,
    });
    const [backend1, backend2, backend3] = backends;

    try {
      // Each instance acquires from different types
      await backend1?.acquireJobType('inst1', 'typeA');
      await backend1?.acquireJobType('inst1', 'typeA');
      await backend2?.acquireJobType('inst2', 'typeB');
      await backend3?.acquireJobType('inst3', 'typeC');
      await backend3?.acquireJobType('inst3', 'typeC');
      await backend3?.acquireJobType('inst3', 'typeC');

      // All instances should see the same stats
      const allStats = await Promise.all(backends.map(async (b) => await b.getJobTypeStats()));

      // Verify all see the same values
      verifyConsistentStats(allStats, 'typeA', TWO);
      verifyConsistentStats(allStats, 'typeB', ONE);
      verifyConsistentStats(allStats, 'typeC', TWO + ONE);
    } finally {
      await stopBackends(backends);
    }
  });
});

describe('Redis Distributed Invariants - New Instance Join', () => {
  it('should allow new instance to participate in shared capacity', async () => {
    if (!state.redisAvailable) return;

    // Both instances connect at the same time (share the same Redis state)
    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: { typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: { typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });

    try {
      // First instance acquires 5 slots
      await acquireSlots(backend1, 'inst1', 'typeA', FIVE);

      // Verify both backends see the same in-flight count
      const stats1 = await backend1.getJobTypeStats();
      const stats2 = await backend2.getJobTypeStats();
      expect(stats1?.jobTypes.typeA?.totalInFlight).toBe(FIVE);
      expect(stats2?.jobTypes.typeA?.totalInFlight).toBe(FIVE);

      // Second instance should be able to acquire remaining slots
      const acquired = await acquireSlots(backend2, 'inst2', 'typeA', TEN);

      // Should acquire exactly 5 (remaining capacity)
      expect(acquired).toBe(FIVE);

      const finalStats = await backend2.getJobTypeStats();
      expect(finalStats?.jobTypes.typeA?.totalInFlight).toBe(TEN);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});
