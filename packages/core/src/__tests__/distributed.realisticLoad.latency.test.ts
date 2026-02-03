/**
 * Realistic load tests - latency scenarios.
 */
import {
  FIFTY,
  FIVE,
  HUNDRED,
  REALISTIC_TEST_TIMEOUT,
  TEN,
  THREE,
  TWENTY,
  TWO,
  ZERO,
  assertLimitsRespected,
  calculateAverage,
  cleanupInstances,
  createLatencyTestSetup,
  fireSlowJobs,
} from './distributed.realisticLoad.helpers.js';
import { createDistributedBackend } from './distributedBackend.helpers.js';

describe('realistic load - basic latency', () => {
  it(
    'should respect limits with 10-50ms acquire latency and 50-200ms jobs',
    async () => {
      const setup = await createLatencyTestSetup(createDistributedBackend, {
        tpm: HUNDRED,
        rpm: TEN,
        instanceCount: THREE,
        jobsPerInstance: TEN,
        tokensPerJob: TEN,
        latency: { acquireMinMs: TEN, acquireMaxMs: FIFTY, releaseMinMs: FIVE, releaseMaxMs: TWENTY },
      });
      await fireSlowJobs(
        setup.instances,
        setup.jpi,
        { minDurationMs: FIFTY, maxDurationMs: HUNDRED * TWO, tokens: TEN },
        setup.tracker
      );
      assertLimitsRespected(setup.backend.getStats(), setup.tpm, setup.rpm);
      expect(setup.tracker.completed).toBe(setup.rpm);
      expect(setup.tracker.failed).toBe(THREE * TEN - setup.rpm);
      expect(setup.tracker.acquireLatencies.length).toBeGreaterThan(ZERO);
      cleanupInstances(setup.instances);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('realistic load - high latency', () => {
  it(
    'should handle high latency backend (50-100ms acquire) under pressure',
    async () => {
      const setup = await createLatencyTestSetup(createDistributedBackend, {
        tpm: FIFTY,
        rpm: FIVE,
        instanceCount: FIVE,
        jobsPerInstance: TEN,
        tokensPerJob: TEN,
        latency: { acquireMinMs: FIFTY, acquireMaxMs: HUNDRED, releaseMinMs: TEN, releaseMaxMs: FIFTY },
      });
      await fireSlowJobs(
        setup.instances,
        setup.jpi,
        { minDurationMs: HUNDRED, maxDurationMs: HUNDRED * THREE, tokens: TEN },
        setup.tracker
      );
      assertLimitsRespected(setup.backend.getStats(), setup.tpm, setup.rpm);
      expect(setup.tracker.completed).toBe(setup.rpm);
      expect(calculateAverage(setup.tracker.acquireLatencies)).toBeGreaterThanOrEqual(FIFTY);
      cleanupInstances(setup.instances);
    },
    REALISTIC_TEST_TIMEOUT
  );
});
