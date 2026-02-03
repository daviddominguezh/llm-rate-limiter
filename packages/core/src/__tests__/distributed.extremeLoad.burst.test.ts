/**
 * Extreme load tests for distributed rate limiting - burst scenarios.
 * These tests validate that the rate limiter NEVER exceeds limits under burst conditions.
 */
import {
  EXTREME_TEST_TIMEOUT,
  FIFTY,
  FIVE,
  FIVE_HUNDRED,
  FIVE_THOUSAND,
  HUNDRED,
  ONE,
  TEN,
  THOUSAND,
  TWO,
  TWO_HUNDRED,
  TWO_THOUSAND,
  ZERO,
  assertJobAccountingCorrect,
  assertLimitsNeverExceeded,
  cleanupInstances,
  createDistributedBackend,
  createJobTracker,
  createTestInstances,
  fireSimultaneousJobs,
  randomInt,
} from './distributed.extremeLoad.helpers.js';

describe('extreme load - burst 10 instances 100 jobs', () => {
  it(
    'should NEVER exceed limits when 10 instances fire 100 jobs each',
    async () => {
      const TPM = THOUSAND;
      const RPM = HUNDRED;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TEN,
      });
      const instances = await createTestInstances(TEN, backend, TEN);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(
        instances,
        HUNDRED,
        { getTokens: () => TEN, getDelay: () => randomInt(ONE, TEN) },
        tracker
      );
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      assertJobAccountingCorrect(tracker, TEN * HUNDRED, stats);
      expect(tracker.completed).toBe(RPM);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - variable job sizes', () => {
  it(
    'should NEVER exceed limits with random token sizes between 1 and 100',
    async () => {
      const TPM = FIVE_HUNDRED;
      const RPM = FIFTY;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: FIFTY,
      });
      const instances = await createTestInstances(FIVE, backend, FIFTY);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(
        instances,
        TWO_HUNDRED,
        { getTokens: () => randomInt(ONE, HUNDRED), getDelay: () => randomInt(ONE, FIVE) },
        tracker
      );
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      assertJobAccountingCorrect(tracker, FIVE * TWO_HUNDRED, stats);
      expect(tracker.failed).toBeGreaterThan(ZERO);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - 2000 concurrent jobs', () => {
  it(
    'should handle massive concurrent load without exceeding limits',
    async () => {
      const TPM = TWO_THOUSAND;
      const RPM = TWO_HUNDRED;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TEN,
      });
      const instances = await createTestInstances(TEN, backend, TEN);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(
        instances,
        TWO_HUNDRED,
        { getTokens: () => TEN, getDelay: () => randomInt(ONE, TEN * TWO) },
        tracker
      );
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      assertJobAccountingCorrect(tracker, TEN * TWO_HUNDRED, stats);
      expect(tracker.completed).toBe(RPM);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - token limit exhaustion', () => {
  it(
    'should stop when token limit is reached even if request limit is not',
    async () => {
      const TPM = FIVE_HUNDRED;
      const RPM = THOUSAND;
      const TPJ = FIFTY;
      const MAX_BY_TOKENS = Math.floor(TPM / TPJ);
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TPJ,
      });
      const instances = await createTestInstances(FIVE, backend, TPJ);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(instances, HUNDRED, { getTokens: () => TPJ, getDelay: () => ONE }, tracker);
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      expect(tracker.completed).toBe(MAX_BY_TOKENS);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - request limit exhaustion', () => {
  it(
    'should stop when request limit is reached even if token limit is not',
    async () => {
      const TPM = FIVE_THOUSAND;
      const RPM = FIFTY;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: ONE,
      });
      const instances = await createTestInstances(TEN, backend, ONE);
      const tracker = createJobTracker();
      await fireSimultaneousJobs(instances, FIFTY, { getTokens: () => ONE, getDelay: () => ONE }, tracker);
      const stats = backend.getStats();
      assertLimitsNeverExceeded(stats, TPM, RPM);
      expect(tracker.completed).toBe(RPM);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});

describe('extreme load - race for last slot', () => {
  it(
    'should correctly handle race when only one slot remains',
    async () => {
      const TPM = HUNDRED;
      const RPM = TEN;
      const backend = createDistributedBackend({
        tokensPerMinute: TPM,
        requestsPerMinute: RPM,
        estimatedTokensPerRequest: TEN,
      });
      const instances = await createTestInstances(TEN, backend, TEN);
      const t1 = createJobTracker();
      await fireSimultaneousJobs(instances, ONE, { getTokens: () => TEN, getDelay: () => ONE }, t1);
      expect(t1.completed).toBe(RPM);
      const t2 = createJobTracker();
      await fireSimultaneousJobs(instances, ONE, { getTokens: () => TEN, getDelay: () => ONE }, t2);
      expect(t2.completed).toBe(ZERO);
      expect(t2.failed).toBe(TEN);
      assertLimitsNeverExceeded(backend.getStats(), TPM, RPM);
      cleanupInstances(instances);
    },
    EXTREME_TEST_TIMEOUT
  );
});
