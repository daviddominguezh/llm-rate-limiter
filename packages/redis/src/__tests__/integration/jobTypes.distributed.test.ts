/**
 * Distributed job types tests for Redis backend.
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
const RATIO_04 = 0.4;
const RATIO_03 = 0.3;
const RATIO_02 = 0.2;

const THREE_TYPES_CONFIG = {
  jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
  jobB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
  jobC: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
};

const FIVE_TYPES_CONFIG = {
  critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02, flexible: false } },
  highPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  normal: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  lowPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
  background: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02 } },
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

describe('Redis Distributed - Limits Across Instances', () => {
  it('should enforce total job type limits across instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: { jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: { jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ONE } } },
    });

    try {
      const acquireFn1 = async (): Promise<boolean> => await backend1.acquireJobType('inst1', 'jobA');
      const acquireFn2 = async (): Promise<boolean> => await backend2.acquireJobType('inst2', 'jobA');

      const results = await Promise.all([
        ...Array.from({ length: TEN }, acquireFn1),
        ...Array.from({ length: FIVE }, acquireFn2),
      ]);

      expect(results.filter((r) => r).length).toBe(TEN);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

describe('Redis Distributed - Release And Reacquire', () => {
  it('should track in-flight across instances after releases', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: THREE_TYPES_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: SMALL_CAPACITY_TEN,
      resourceEstimationsPerJob: THREE_TYPES_CONFIG,
    });

    try {
      await backend1.acquireJobType('inst1', 'jobA');
      await backend1.acquireJobType('inst1', 'jobA');
      await backend2.acquireJobType('inst2', 'jobA');
      await backend2.acquireJobType('inst2', 'jobA');

      expect(await backend1.acquireJobType('inst1', 'jobA')).toBe(false);
      await backend1.releaseJobType('inst1', 'jobA');
      expect(await backend2.acquireJobType('inst2', 'jobA')).toBe(true);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

describe('Redis Distributed - Shared Stats', () => {
  it('should show same stats across all instances', async () => {
    if (!state.redisAvailable) return;

    const backend1 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: THREE_TYPES_CONFIG,
    });
    const backend2 = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: THREE_TYPES_CONFIG,
    });

    try {
      const acquireFn = async (): Promise<boolean> => await backend1.acquireJobType('inst1', 'jobA');
      await Promise.all(Array.from({ length: FIVE }, acquireFn));

      const [stats1, stats2] = await Promise.all([backend1.getJobTypeStats(), backend2.getJobTypeStats()]);

      expect(stats1?.jobTypes.jobA?.totalInFlight).toBe(FIVE);
      expect(stats2?.jobTypes.jobA?.totalInFlight).toBe(FIVE);
    } finally {
      await backend1.stop();
      await backend2.stop();
    }
  });
});

describe('Redis Distributed - Non-Flexible Preservation', () => {
  it('should preserve non-flexible ratio across instances', async () => {
    if (!state.redisAvailable) return;

    const backend = createTestBackend(state, createRedisBackend, {
      capacity: MEDIUM_CAPACITY,
      resourceEstimationsPerJob: FIVE_TYPES_CONFIG,
    });

    try {
      const initialStats = await backend.getJobTypeStats();
      const initialSlots = initialStats?.jobTypes.critical?.allocatedSlots ?? ZERO;
      const highPriSlots = initialStats?.jobTypes.highPri?.allocatedSlots ?? ZERO;

      const acquireFn = async (): Promise<boolean> => await backend.acquireJobType('inst1', 'highPri');
      await Promise.all(Array.from({ length: highPriSlots }, acquireFn));

      const finalStats = await backend.getJobTypeStats();
      expect(finalStats?.jobTypes.critical?.allocatedSlots).toBe(initialSlots);
    } finally {
      await backend.stop();
    }
  });
});
