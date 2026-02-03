/**
 * Extreme load tests for distributed rate limiting - sustained and ultimate scenarios.
 * These tests validate limit enforcement across time windows and at extreme scale.
 */
import {
  EXTREME_TEST_TIMEOUT,
  FIFTY,
  FIVE,
  FIVE_HUNDRED,
  HUNDRED,
  MS_PER_MINUTE,
  ONE,
  TEN,
  THOUSAND,
  THREE,
  TWENTY,
  TWO_HUNDRED,
  ZERO,
  assertLimitsNeverExceeded,
  cleanupInstances,
  createDistributedBackend,
  createJobTracker,
  createTestInstances,
  fireSimultaneousJobs,
  randomInt,
} from './distributed.extremeLoad.helpers.js';

describe('extreme load - sustained across windows', () => {
  it(
    'should correctly reset and enforce limits across 3 time windows',
    async () => {
      const TPM = TWO_HUNDRED;
      const RPM = TWENTY;
      const WINDOWS = THREE;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TEN,
      });
      const instances = await createTestInstances(THREE, backend, TEN);
      let totalCompleted = ZERO;
      const runWindow = async (): Promise<number> => {
        const t = createJobTracker();
        const jobsPerInstance = Math.floor(FIFTY / THREE);
        await fireSimultaneousJobs(
          instances,
          jobsPerInstance,
          { getTokens: () => TEN, getDelay: () => ONE },
          t
        );
        assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
        return t.completed;
      };
      totalCompleted += await runWindow();
      backend.advanceTime(MS_PER_MINUTE + ONE);
      totalCompleted += await runWindow();
      backend.advanceTime(MS_PER_MINUTE + ONE);
      totalCompleted += await runWindow();
      expect(totalCompleted).toBe(RPM * WINDOWS);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - 5000 jobs stress', () => {
  it(
    'should handle 5000 jobs across 10 instances without violations',
    async () => {
      const TPM = FIVE * THOUSAND;
      const RPM = FIVE_HUNDRED;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TEN,
      });
      const instances = await createTestInstances(TEN, backend, TEN);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(
        instances,
        FIVE_HUNDRED,
        { getTokens: () => TEN, getDelay: () => randomInt(ONE, TEN) },
        tracker
      );
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      expect(tracker.completed + tracker.failed).toBe(TEN * FIVE_HUNDRED);
      expect(tracker.completed).toBe(RPM);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - ultimate 10000 jobs', () => {
  it(
    'ULTIMATE: 10000 jobs, 20 instances, variable sizes, multiple windows',
    async () => {
      const TPM = THOUSAND;
      const RPM = HUNDRED;
      const WINDOWS = FIVE;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TWENTY,
      });
      const instances = await createTestInstances(TWENTY, backend, TWENTY);
      let grandTotal = ZERO;
      const runWindow = async (): Promise<number> => {
        backend.reset();
        const t = createJobTracker();
        await fireSimultaneousJobs(
          instances,
          HUNDRED,
          { getTokens: () => randomInt(FIVE, FIFTY), getDelay: () => randomInt(ONE, TWENTY) },
          t
        );
        assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
        expect(t.completed).toBeLessThanOrEqual(RPM);
        expect(t.completed).toBeGreaterThan(ZERO);
        return t.completed + t.failed;
      };
      grandTotal += await runWindow();
      grandTotal += await runWindow();
      grandTotal += await runWindow();
      grandTotal += await runWindow();
      grandTotal += await runWindow();
      expect(grandTotal).toBe(TWENTY * HUNDRED * WINDOWS);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});
