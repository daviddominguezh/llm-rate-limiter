/**
 * Production-like stress test for job types with Redis backend.
 * Simulates 10,000+ jobs with bursty traffic patterns across multiple instances.
 */
import { createRedisBackend } from '../../redisBackend.js';
import type { RedisBackendInstance } from '../../types.js';
import {
  CAPACITY,
  INSTANCE_COUNT,
  JOB_TYPES_CONFIG,
  JOB_TYPE_NAMES,
  ONE,
  TEST_TIMEOUT_MS,
  TOTAL_JOBS,
  ZERO,
  createMetrics,
} from './stressTest.helpers.js';
import type { StressTestMetrics } from './stressTest.helpers.js';
import { logMetricsSummary } from './stressTest.logging.js';
import { createInvariantMonitor, runFinalInvariantCheck } from './stressTest.monitor.js';
import { generateBurstyTraffic, getTotalProcessed } from './stressTest.traffic.js';
import {
  createTestBackend,
  createTestState,
  setupAfterAll,
  setupAfterEach,
  setupBeforeAll,
  setupBeforeEach,
} from './testSetup.js';

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

/**
 * Create multiple backend instances for the stress test.
 */
const createBackends = (): RedisBackendInstance[] => {
  const backends: RedisBackendInstance[] = [];
  for (let i = ZERO; i < INSTANCE_COUNT; i += ONE) {
    backends.push(
      createTestBackend(state, createRedisBackend, {
        capacity: CAPACITY,
        resourceEstimationsPerJob: JOB_TYPES_CONFIG,
      })
    );
  }
  return backends;
};

/**
 * Get the first backend from the array.
 */
const getFirstBackend = (backends: RedisBackendInstance[]): RedisBackendInstance | undefined => {
  const [first] = backends;
  return first;
};

/**
 * Verify final state assertions.
 */
const verifyFinalState = async (
  backends: RedisBackendInstance[],
  metrics: StressTestMetrics
): Promise<void> => {
  const totalProcessed = getTotalProcessed(metrics);
  expect(totalProcessed).toBe(TOTAL_JOBS);
  expect(metrics.invariantViolations.length).toBe(ZERO);
  expect(metrics.totalInFlightPeak).toBeLessThanOrEqual(CAPACITY);

  const firstBackend = getFirstBackend(backends);
  if (firstBackend !== undefined) {
    const finalStats = await firstBackend.getJobTypeStats();
    for (const jobType of JOB_TYPE_NAMES) {
      const typeStats = finalStats?.jobTypes[jobType];
      expect(typeStats?.totalInFlight).toBe(ZERO);
    }
  }
};

/**
 * Stop all backends gracefully.
 */
const stopBackends = async (backends: RedisBackendInstance[]): Promise<void> => {
  await Promise.all(
    backends.map(async (b) => {
      await b.stop();
    })
  );
};

/**
 * Set the end time on metrics.
 */
const setEndTime = (metrics: StressTestMetrics): void => {
  Object.assign(metrics, { endTime: Date.now() });
};

describe('Redis Production-Like Stress Test', () => {
  it(
    'should handle 10,000+ jobs with bursty traffic across multiple instances',
    async () => {
      if (!state.redisAvailable) {
        process.stdout.write('Skipping stress test - Redis not available\n');
        return;
      }

      const backends = createBackends();
      const metrics = createMetrics();
      const firstBackend = getFirstBackend(backends);

      if (firstBackend === undefined) {
        throw new Error('Failed to create backends');
      }

      const monitor = createInvariantMonitor(firstBackend, metrics);

      try {
        monitor.start();

        const pendingJobs = await generateBurstyTraffic(backends, metrics);
        await Promise.all(pendingJobs);

        setEndTime(metrics);

        await runFinalInvariantCheck(firstBackend, metrics);
        logMetricsSummary(metrics);
        await verifyFinalState(backends, metrics);
      } finally {
        monitor.stop();
        await stopBackends(backends);
      }
    },
    TEST_TIMEOUT_MS
  );
});
