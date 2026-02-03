/**
 * Realistic load tests - latency tracking scenarios.
 */
import {
  FIFTY,
  HUNDRED,
  REALISTIC_TEST_TIMEOUT,
  TEN,
  THIRTY,
  TWENTY,
  TWO,
  calculateAverage,
  cleanupInstances,
  createLatencyTestSetup,
  fireSlowJobs,
} from './distributed.realisticLoad.helpers.js';
import { createDistributedBackend } from './distributedBackend.helpers.js';

const ACQ_MIN = TWENTY;
const ACQ_MAX = FIFTY;
const REL_MIN = TEN;
const REL_MAX = THIRTY;

describe('realistic load - latency tracking', () => {
  it(
    'should track latency statistics accurately',
    async () => {
      const setup = await createLatencyTestSetup(createDistributedBackend, {
        tpm: HUNDRED,
        rpm: TEN,
        instanceCount: TWO,
        jobsPerInstance: TEN,
        tokensPerJob: TEN,
        latency: {
          acquireMinMs: ACQ_MIN,
          acquireMaxMs: ACQ_MAX,
          releaseMinMs: REL_MIN,
          releaseMaxMs: REL_MAX,
        },
      });
      await fireSlowJobs(
        setup.instances,
        setup.jpi,
        { minDurationMs: FIFTY, maxDurationMs: HUNDRED, tokens: TEN },
        setup.tracker
      );
      const avgAcquire = calculateAverage(setup.tracker.acquireLatencies);
      const avgRelease = calculateAverage(setup.tracker.releaseLatencies);
      expect(avgAcquire).toBeGreaterThanOrEqual(ACQ_MIN);
      expect(avgAcquire).toBeLessThanOrEqual(ACQ_MAX);
      expect(avgRelease).toBeGreaterThanOrEqual(REL_MIN);
      expect(avgRelease).toBeLessThanOrEqual(REL_MAX);
      cleanupInstances(setup.instances);
    },
    REALISTIC_TEST_TIMEOUT
  );
});
