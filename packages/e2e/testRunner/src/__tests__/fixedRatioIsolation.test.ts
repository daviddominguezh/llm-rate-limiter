/**
 * Test suite: Fixed Ratio Isolation
 *
 * Verifies that job types with flexible: false maintain their capacity
 * even when other job types fill up or have high load.
 *
 * Uses the fixedRatio config preset:
 * - test-model: 100K TPM
 * - fixedJobType: 10K tokens, ratio 0.5, flexible: false
 * - flexibleJobType: 10K tokens, ratio 0.5, flexible: true
 *
 * Expected slots with 2 instances:
 * - fixedJobType: floor((100K/10K) / 2 * 0.5) = floor(5 * 0.5) = 2 per instance = 4 total
 * - flexibleJobType: floor((100K/10K) / 2 * 0.5) = floor(5 * 0.5) = 2 per instance = 4 total
 *
 * Key behavior to verify:
 * - When flexibleJobType is overloaded, fixedJobType capacity remains unchanged
 * - Fixed ratio job types maintain their allocated slots regardless of load on other types
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With fixedRatio config and 2 instances:
// Each job type gets: floor((100K/10K) / 2 * 0.5) = 2 slots per instance = 4 total
const FIXED_JOB_TYPE_SLOTS = 4;
const FLEXIBLE_JOB_TYPE_SLOTS = 4;

const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;
const CONFIG_PRESET: ConfigPresetName = 'fixedRatio';

describe('Fixed Ratio Isolation', () => {
  describe('Fixed Job Type Maintains Capacity', () => {
    let data: TestData;

    beforeAll(async () => {
      // Send fixed job type jobs at exactly its capacity
      // These should all complete because fixed ratio is protected
      const fixedJobs = generateJobsOfType(FIXED_JOB_TYPE_SLOTS, 'fixedJobType', {
        prefix: 'fixed-isolation',
        durationMs: JOB_DURATION_MS,
      });

      // Also send flexible jobs at its capacity
      const flexibleJobs = generateJobsOfType(FLEXIBLE_JOB_TYPE_SLOTS, 'flexibleJobType', {
        prefix: 'flexible-isolation',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'fixed-ratio-isolation',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...fixedJobs, ...flexibleJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all fixed job type jobs', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('fixed-isolation'));
      const completedFixed = fixedJobs.filter((j) => j.status === 'completed');
      expect(completedFixed.length).toBe(FIXED_JOB_TYPE_SLOTS);
    });

    it('should complete all flexible job type jobs', () => {
      const flexibleJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flexible-isolation'));
      const completedFlexible = flexibleJobs.filter((j) => j.status === 'completed');
      expect(completedFlexible.length).toBe(FLEXIBLE_JOB_TYPE_SLOTS);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Fixed Ratio Not Affected by Flexible Overload', () => {
    /**
     * Scenario:
     * 1. Send jobs to completely fill flexibleJobType capacity
     * 2. Simultaneously send fixedJobType jobs
     * 3. fixedJobType jobs should complete because they have protected capacity
     */
    let data: TestData;

    beforeAll(async () => {
      // Overfill flexible job type (send more than its capacity)
      const flexibleJobs = generateJobsOfType(FLEXIBLE_JOB_TYPE_SLOTS + 2, 'flexibleJobType', {
        prefix: 'overload-flex',
        durationMs: JOB_DURATION_MS * 10, // Longer duration to keep slots occupied
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
        jobs: [...flexibleJobs, ...fixedJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS * 2,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS * 2);

    it('should complete all fixed job type jobs', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('protected-fixed'));
      const completedFixed = fixedJobs.filter((j) => j.status === 'completed');

      // Key assertion: fixed jobs complete even when flexible is overloaded
      expect(completedFixed.length).toBe(FIXED_JOB_TYPE_SLOTS);
    });

    it('should eventually complete all flexible job type jobs', () => {
      const flexibleJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('overload-flex'));
      const completedFlexible = flexibleJobs.filter((j) => j.status === 'completed');

      // All flexible jobs should eventually complete (some may wait for capacity)
      expect(completedFlexible.length).toBe(FLEXIBLE_JOB_TYPE_SLOTS + 2);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });

    it('fixed jobs should complete quickly without waiting', () => {
      const fixedJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('protected-fixed'));

      // Fixed jobs should complete quickly (not waiting for flexible to free up)
      for (const job of fixedJobs) {
        // Queue duration should be minimal (less than a second) for protected capacity
        const queueDuration = job.queueDurationMs ?? 0;
        expect(queueDuration).toBeLessThan(2000);
      }
    });
  });
});
