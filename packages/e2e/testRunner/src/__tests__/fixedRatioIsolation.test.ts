/**
 * Test suite: Fixed Ratio Isolation
 *
 * Verifies that job types with flexible: false maintain their capacity
 * even when other job types fill up or have high load.
 *
 * Uses the fixedRatio config preset:
 * - test-model: 100K TPM
 * - fixedJobType: 10K tokens, ratio 0.4, flexible: false
 * - flexibleJobTypeA: 10K tokens, ratio 0.3, flexible: true
 * - flexibleJobTypeB: 10K tokens, ratio 0.3, flexible: true
 *
 * Expected slots with 2 instances:
 * - fixedJobType: floor((100K/10K) / 2 * 0.4) = floor(5 * 0.4) = 2 per instance = 4 total
 * - flexibleJobTypeA: floor((100K/10K) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total
 * - flexibleJobTypeB: floor((100K/10K) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total
 *
 * Key behavior to verify:
 * - When flexible types are overloaded, fixedJobType capacity remains unchanged
 * - Fixed ratio job types maintain their allocated slots regardless of load on other types
 * - Flexible types can borrow from each other but not from fixed types
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With fixedRatio config and 2 instances:
// fixedJobType: floor((100K/10K) / 2 * 0.4) = 2 per instance = 4 total
// flexibleJobTypeA: floor((100K/10K) / 2 * 0.3) = 1 per instance = 2 total
// flexibleJobTypeB: floor((100K/10K) / 2 * 0.3) = 1 per instance = 2 total
const FIXED_JOB_TYPE_SLOTS = 4;
const FLEXIBLE_JOB_TYPE_A_SLOTS = 2;
const FLEXIBLE_JOB_TYPE_B_SLOTS = 2;

const JOB_DURATION_MS = 100;
const LONG_JOB_DURATION_MS = 1000;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;
const CONFIG_PRESET: ConfigPresetName = 'fixedRatio';

describe('Fixed Ratio Isolation', () => {
  describe('All Job Types Complete at Capacity', () => {
    /**
     * Basic test: All job types should complete when sent at their capacity.
     */
    let data: TestData;

    beforeAll(async () => {
      const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
        prefix: 'fixed-basic',
        durationMs: JOB_DURATION_MS,
      });

      const flexibleJobsA = generateJobsOfType(FLEXIBLE_JOB_TYPE_A_SLOTS, 'flexibleJobTypeA', {
        prefix: 'flex-a-basic',
        durationMs: JOB_DURATION_MS,
      });

      const flexibleJobsB = generateJobsOfType(FLEXIBLE_JOB_TYPE_B_SLOTS, 'flexibleJobTypeB', {
        prefix: 'flex-b-basic',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'fixed-ratio-basic',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...fixedJobs, ...flexibleJobsA, ...flexibleJobsB],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all fixedJobType jobs', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('fixed-basic'));
      const completedFixed = fixedJobs.filter((j) => j.status === 'completed');
      expect(completedFixed.length).toBe(FIXED_JOB_TYPE_SLOTS);
    });

    it('should complete all flexibleJobTypeA jobs', () => {
      const flexJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flex-a-basic'));
      const completedFlex = flexJobs.filter((j) => j.status === 'completed');
      expect(completedFlex.length).toBe(FLEXIBLE_JOB_TYPE_A_SLOTS);
    });

    it('should complete all flexibleJobTypeB jobs', () => {
      const flexJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flex-b-basic'));
      const completedFlex = flexJobs.filter((j) => j.status === 'completed');
      expect(completedFlex.length).toBe(FLEXIBLE_JOB_TYPE_B_SLOTS);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Fixed Ratio Not Affected by Flexible Overload', () => {
    /**
     * Scenario:
     * 1. Send jobs to completely fill both flexible types (overload them)
     * 2. Simultaneously send fixedJobType jobs
     * 3. fixedJobType jobs should complete because they have protected capacity
     */
    let data: TestData;

    beforeAll(async () => {
      // Overfill both flexible job types (send more than their capacity)
      const flexibleJobsA = generateJobsOfType(FLEXIBLE_JOB_TYPE_A_SLOTS + 2, 'flexibleJobTypeA', {
        prefix: 'overload-flex-a',
        durationMs: LONG_JOB_DURATION_MS, // Longer duration to keep slots occupied
      });

      const flexibleJobsB = generateJobsOfType(FLEXIBLE_JOB_TYPE_B_SLOTS + 2, 'flexibleJobTypeB', {
        prefix: 'overload-flex-b',
        durationMs: LONG_JOB_DURATION_MS,
      });

      // Send fixed job type jobs at exactly its capacity
      const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
        prefix: 'protected-fixed',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'fixed-not-affected-by-overload',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...flexibleJobsA, ...flexibleJobsB, ...fixedJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS * 2,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS * 2);

    it('should complete all fixedJobType jobs', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('protected-fixed'));
      const completedFixed = fixedJobs.filter((j) => j.status === 'completed');

      // Key assertion: fixed jobs complete even when flexible types are overloaded
      expect(completedFixed.length).toBe(FIXED_JOB_TYPE_SLOTS);
    });

    it('should eventually complete all flexibleJobTypeA jobs', () => {
      const flexJobsA = Object.values(data.jobs).filter((j) => j.jobId.startsWith('overload-flex-a'));
      const completedFlexA = flexJobsA.filter((j) => j.status === 'completed');

      // All flexible A jobs should eventually complete (some may wait for capacity)
      expect(completedFlexA.length).toBe(FLEXIBLE_JOB_TYPE_A_SLOTS + 2);
    });

    it('should eventually complete all flexibleJobTypeB jobs', () => {
      const flexJobsB = Object.values(data.jobs).filter((j) => j.jobId.startsWith('overload-flex-b'));
      const completedFlexB = flexJobsB.filter((j) => j.status === 'completed');

      // All flexible B jobs should eventually complete (some may wait for capacity)
      expect(completedFlexB.length).toBe(FLEXIBLE_JOB_TYPE_B_SLOTS + 2);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });

    it('fixedJobType jobs should complete quickly without waiting', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('protected-fixed'));

      // Fixed jobs should complete quickly (not waiting for flexible to free up)
      for (const job of fixedJobs) {
        // Queue duration should be minimal (less than 2 seconds) for protected capacity
        const queueDuration = job.queueDurationMs ?? 0;
        expect(queueDuration).toBeLessThan(2000);
      }
    });
  });

  describe('Flexible Types Can Borrow From Each Other But Not From Fixed', () => {
    /**
     * Scenario:
     * 1. Send heavy load to flexibleJobTypeA (overload it)
     * 2. Keep flexibleJobTypeB mostly idle
     * 3. Send fixedJobType jobs at capacity
     *
     * Expected:
     * - flexibleJobTypeA should be able to use some of flexibleJobTypeB's capacity
     * - fixedJobType should complete at its protected capacity
     * - fixedJobType should NOT donate capacity to flexible types
     */
    let data: TestData;

    beforeAll(async () => {
      // Heavy load on flexibleJobTypeA
      const flexibleJobsA = generateJobsOfType(FLEXIBLE_JOB_TYPE_A_SLOTS + 3, 'flexibleJobTypeA', {
        prefix: 'heavy-flex-a',
        durationMs: JOB_DURATION_MS,
      });

      // Minimal load on flexibleJobTypeB (only 1 job)
      const flexibleJobsB = generateJobsOfType(1, 'flexibleJobTypeB', {
        prefix: 'light-flex-b',
        durationMs: JOB_DURATION_MS,
      });

      // Fixed jobs at capacity
      const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
        prefix: 'fixed-protected',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'flexible-borrow-not-from-fixed',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...flexibleJobsA, ...flexibleJobsB, ...fixedJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all fixedJobType jobs', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('fixed-protected'));
      const completedFixed = fixedJobs.filter((j) => j.status === 'completed');
      expect(completedFixed.length).toBe(FIXED_JOB_TYPE_SLOTS);
    });

    it('should complete all flexibleJobTypeA jobs (using borrowed capacity)', () => {
      const flexJobsA = Object.values(data.jobs).filter((j) => j.jobId.startsWith('heavy-flex-a'));
      const completedFlexA = flexJobsA.filter((j) => j.status === 'completed');

      // All should complete - can borrow from idle flexibleJobTypeB
      expect(completedFlexA.length).toBe(FLEXIBLE_JOB_TYPE_A_SLOTS + 3);
    });

    it('should complete the flexibleJobTypeB job', () => {
      const flexJobsB = Object.values(data.jobs).filter((j) => j.jobId.startsWith('light-flex-b'));
      const completedFlexB = flexJobsB.filter((j) => j.status === 'completed');
      expect(completedFlexB.length).toBe(1);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });

    it('fixedJobType jobs should complete quickly', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('fixed-protected'));

      for (const job of fixedJobs) {
        const queueDuration = job.queueDurationMs ?? 0;
        // Fixed jobs should not wait for flexible types
        expect(queueDuration).toBeLessThan(2000);
      }
    });
  });
});
