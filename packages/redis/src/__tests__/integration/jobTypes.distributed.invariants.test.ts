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
const RATIO_02 = 0.2;

const TWO_TYPES_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
  typeB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
};

const THREE_TYPES_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
  typeB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
  typeC: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
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
      resourcesPerJob: { singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: { singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });
    const backend3 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: { singleType: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
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
      const successCount = results.filter((r) => r).length;

      // Exactly 10 should succeed (total capacity)
      expect(successCount).toBe(TEN);

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
      resourcesPerJob: TWO_TYPES_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: TWO_TYPES_CONFIG,
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

describe('Redis Distributed Invariants - Consistent Stats', () => {
  it('should maintain consistent stats view across all instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourcesPerJob: THREE_TYPES_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourcesPerJob: THREE_TYPES_CONFIG,
    });
    const backend3 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourcesPerJob: THREE_TYPES_CONFIG,
    });

    try {
      // Each instance acquires from different types
      await backend1.acquireJobType('inst1', 'typeA');
      await backend1.acquireJobType('inst1', 'typeA');
      await backend2.acquireJobType('inst2', 'typeB');
      await backend3.acquireJobType('inst3', 'typeC');
      await backend3.acquireJobType('inst3', 'typeC');
      await backend3.acquireJobType('inst3', 'typeC');

      // All instances should see the same stats
      const [stats1, stats2, stats3] = await Promise.all([
        backend1.getJobTypeStats(),
        backend2.getJobTypeStats(),
        backend3.getJobTypeStats(),
      ]);

      // Verify all see the same values
      expect(stats1?.jobTypes.typeA?.totalInFlight).toBe(TWO);
      expect(stats2?.jobTypes.typeA?.totalInFlight).toBe(TWO);
      expect(stats3?.jobTypes.typeA?.totalInFlight).toBe(TWO);

      expect(stats1?.jobTypes.typeB?.totalInFlight).toBe(ONE);
      expect(stats2?.jobTypes.typeB?.totalInFlight).toBe(ONE);
      expect(stats3?.jobTypes.typeB?.totalInFlight).toBe(ONE);

      expect(stats1?.jobTypes.typeC?.totalInFlight).toBe(TWO + ONE);
      expect(stats2?.jobTypes.typeC?.totalInFlight).toBe(TWO + ONE);
      expect(stats3?.jobTypes.typeC?.totalInFlight).toBe(TWO + ONE);
    } finally {
      await backend1.stop();
      await backend2.stop();
      await backend3.stop();
    }
  });
});

describe('Redis Distributed Invariants - New Instance Join', () => {
  it('should allow new instance to participate in shared capacity', async () => {
    if (!state.redisAvailable) return;

    // Both instances connect at the same time (share the same Redis state)
    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: { typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourcesPerJob: { typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });

    try {
      // First instance acquires 5 slots
      for (let i = ZERO; i < FIVE; i += ONE) {
        await backend1.acquireJobType('inst1', 'typeA');
      }

      // Verify both backends see the same in-flight count
      const stats1 = await backend1.getJobTypeStats();
      const stats2 = await backend2.getJobTypeStats();
      expect(stats1?.jobTypes.typeA?.totalInFlight).toBe(FIVE);
      expect(stats2?.jobTypes.typeA?.totalInFlight).toBe(FIVE);

      // Second instance should be able to acquire remaining slots
      let acquired = ZERO;
      for (let i = ZERO; i < TEN; i += ONE) {
        if (await backend2.acquireJobType('inst2', 'typeA')) {
          acquired += ONE;
        }
      }

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

describe('Redis Distributed Invariants - Total InFlight Never Exceeds Capacity', () => {
  it('should never allow total inFlight to exceed allocated slots across instances', async () => {
    if (!state.redisAvailable) return;

    const backends = await Promise.all(
      Array.from({ length: FIVE }, () =>
        createTestBackend(state, createRedisBackend, {
          capacity: SMALL_CAPACITY_TEN,
          resourcesPerJob: TWO_TYPES_CONFIG,
        })
      )
    );

    try {
      // Each instance tries to acquire all slots for typeA (which has 5 slots)
      const allPromises: Array<Promise<boolean>> = [];
      backends.forEach((backend, idx) => {
        for (let i = ZERO; i < TEN; i += ONE) {
          allPromises.push(backend.acquireJobType(`inst${idx}`, 'typeA'));
        }
      });

      const results = await Promise.all(allPromises);
      const totalAcquired = results.filter((r) => r).length;

      // Should have acquired exactly 5 (the allocated slots for typeA)
      expect(totalAcquired).toBe(FIVE);

      // Verify stats
      const firstBackend = backends[ZERO];
      if (firstBackend !== undefined) {
        const stats = await firstBackend.getJobTypeStats();
        expect(stats?.jobTypes.typeA?.totalInFlight).toBe(FIVE);
        expect(stats?.jobTypes.typeA?.totalInFlight).toBeLessThanOrEqual(
          stats?.jobTypes.typeA?.allocatedSlots ?? ZERO
        );
      }
    } finally {
      await Promise.all(backends.map((b) => b.stop()));
    }
  });
});

describe('Redis Distributed Invariants - Non-Flexible Ratio Preserved', () => {
  it('should preserve non-flexible ratio across all instances', async () => {
    if (!state.redisAvailable) return;

    const configWithNonFlexible = {
      critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02, flexible: false } },
      normal: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
      background: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
    };

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourcesPerJob: configWithNonFlexible,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourcesPerJob: configWithNonFlexible,
    });

    try {
      // Get initial critical slots allocation
      const initialStats = await backend1.getJobTypeStats();
      const criticalSlots = initialStats?.jobTypes.critical?.allocatedSlots ?? ZERO;

      // Put high load on normal type from both instances
      const normalSlots = initialStats?.jobTypes.normal?.allocatedSlots ?? ZERO;
      const acquirePromises: Array<Promise<boolean>> = [];
      for (let i = ZERO; i < normalSlots; i += ONE) {
        acquirePromises.push(backend1.acquireJobType('inst1', 'normal'));
        acquirePromises.push(backend2.acquireJobType('inst2', 'normal'));
      }
      await Promise.all(acquirePromises);

      // Critical (non-flexible) should maintain its allocation
      const stats1 = await backend1.getJobTypeStats();
      const stats2 = await backend2.getJobTypeStats();

      expect(stats1?.jobTypes.critical?.allocatedSlots).toBe(criticalSlots);
      expect(stats2?.jobTypes.critical?.allocatedSlots).toBe(criticalSlots);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});
