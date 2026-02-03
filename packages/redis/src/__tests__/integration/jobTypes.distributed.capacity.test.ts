/**
 * Distributed job types capacity tests for Redis backend.
 * Verifies capacity constraints across multiple instances.
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
const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const HUNDRED = 100;
const MEDIUM_CAPACITY = 50;
const RATIO_HALF = 0.5;
const RATIO_04 = 0.4;
const RATIO_02 = 0.2;

const TWO_TYPES_CONFIG = {
  typeA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
  typeB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HALF } },
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

describe('Redis Distributed Invariants - Total InFlight Never Exceeds Capacity', () => {
  it('should never allow total inFlight to exceed allocated slots across instances', async () => {
    if (!state.redisAvailable) return;

    const backends = Array.from({ length: FIVE }, () =>
      createTestBackend(state, createRedisBackend, {
        capacity: SMALL_CAPACITY_TEN,
        resourceEstimationsPerJob: TWO_TYPES_CONFIG,
      })
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
      const successfulResults = results.filter((r) => r);

      // Should have acquired exactly 5 (the allocated slots for typeA)
      expect(successfulResults).toHaveLength(FIVE);

      // Verify stats
      const [firstBackend] = backends;
      if (firstBackend !== undefined) {
        const stats = await firstBackend.getJobTypeStats();
        expect(stats?.jobTypes.typeA?.totalInFlight).toBe(FIVE);
        expect(stats?.jobTypes.typeA?.totalInFlight).toBeLessThanOrEqual(
          stats?.jobTypes.typeA?.allocatedSlots ?? ZERO
        );
      }
    } finally {
      await Promise.all(
        backends.map(async (b) => {
          await b.stop();
        })
      );
    }
  });
});

/** Non-flexible ratio test config */
const NON_FLEXIBLE_CONFIG = {
  critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02, flexible: false } },
  normal: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
  background: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
};

/** Helper to get slot counts from stats */
const getSlotCounts = (
  stats: Awaited<ReturnType<ReturnType<typeof createTestBackend>['getJobTypeStats']>>
): { critical: number; normal: number } => ({
  critical: stats?.jobTypes.critical?.allocatedSlots ?? ZERO,
  normal: stats?.jobTypes.normal?.allocatedSlots ?? ZERO,
});

/** Helper to verify critical slots are preserved */
const verifyCriticalSlots = async (
  backends: Array<ReturnType<typeof createTestBackend>>,
  expectedSlots: number
): Promise<void> => {
  for (const backend of backends) {
    // eslint-disable-next-line no-await-in-loop -- Sequential verification needed
    const stats = await backend.getJobTypeStats();
    expect(stats?.jobTypes.critical?.allocatedSlots).toBe(expectedSlots);
  }
};

describe('Redis Distributed Invariants - Non-Flexible Ratio Preserved', () => {
  it('should preserve non-flexible ratio across all instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: NON_FLEXIBLE_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: NON_FLEXIBLE_CONFIG,
    });
    const backends = [backend1, backend2];

    try {
      // Get initial slot counts
      const initialStats = await backend1.getJobTypeStats();
      const { critical: criticalSlots, normal: normalSlots } = getSlotCounts(initialStats);

      // Put high load on normal type from both instances
      const acquirePromises: Array<Promise<boolean>> = [];
      for (let i = ZERO; i < normalSlots; i += ONE) {
        acquirePromises.push(backend1.acquireJobType('inst1', 'normal'));
        acquirePromises.push(backend2.acquireJobType('inst2', 'normal'));
      }
      await Promise.all(acquirePromises);

      // Critical (non-flexible) should maintain its allocation
      await verifyCriticalSlots(backends, criticalSlots);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});
