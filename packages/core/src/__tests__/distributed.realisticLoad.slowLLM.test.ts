/**
 * Realistic load tests - slow LLM simulation scenarios.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import {
  FIFTY,
  FIVE,
  FIVE_HUNDRED,
  HUNDRED,
  REALISTIC_TEST_TIMEOUT,
  TEN,
  THIRTY,
  THOUSAND,
  THREE,
  TWENTY,
  TWO,
  assertLimitsRespected,
  calculateAverage,
  cleanupInstances,
  createLatencyTestSetup,
  fireSlowJobs,
} from './distributed.realisticLoad.helpers.js';
import { createDistributedBackend } from './distributedBackend.helpers.js';

describe('realistic load - very slow jobs', () => {
  it(
    'should maintain correctness with very slow jobs (500-1000ms) simulating LLM calls',
    async () => {
      const setup = await createLatencyTestSetup(createDistributedBackend, {
        tpm: FIFTY,
        rpm: FIVE,
        instanceCount: TWO,
        jobsPerInstance: FIVE,
        tokensPerJob: TEN,
        latency: { acquireMinMs: TWENTY, acquireMaxMs: FIFTY, releaseMinMs: TEN, releaseMaxMs: THIRTY },
      });
      await fireSlowJobs(
        setup.instances,
        setup.jpi,
        { minDurationMs: FIVE_HUNDRED, maxDurationMs: THOUSAND, tokens: TEN },
        setup.tracker
      );
      assertLimitsRespected(setup.backend.getStats(), setup.tpm, setup.rpm);
      expect(setup.tracker.completed).toBe(setup.rpm);
      expect(calculateAverage(setup.tracker.jobDurations)).toBeGreaterThanOrEqual(FIVE_HUNDRED);
      expect(setup.tracker.totalDurationMs).toBeGreaterThanOrEqual(FIVE_HUNDRED);
      cleanupInstances(setup.instances);
    },
    REALISTIC_TEST_TIMEOUT
  );
});

describe('realistic load - mixed fast and slow', () => {
  it(
    'should handle mixed fast and slow jobs with latency',
    async () => {
      const setup = await createLatencyTestSetup(createDistributedBackend, {
        tpm: HUNDRED,
        rpm: TEN,
        instanceCount: THREE,
        jobsPerInstance: TWENTY,
        tokensPerJob: TEN,
        latency: { acquireMinMs: FIVE, acquireMaxMs: FIFTY, releaseMinMs: FIVE, releaseMaxMs: TWENTY },
      });
      await fireSlowJobs(
        setup.instances,
        setup.jpi,
        { minDurationMs: TEN, maxDurationMs: HUNDRED * FIVE, tokens: TEN },
        setup.tracker
      );
      await sleep(HUNDRED);
      const stats = setup.backend.getStats();
      assertLimitsRespected(stats, setup.tpm, setup.rpm);
      expect(setup.tracker.completed).toBe(setup.rpm);
      expect(stats.totalAcquires).toBe(setup.tracker.completed);
      expect(stats.totalReleases).toBe(setup.tracker.completed);
      cleanupInstances(setup.instances);
    },
    REALISTIC_TEST_TIMEOUT
  );
});
