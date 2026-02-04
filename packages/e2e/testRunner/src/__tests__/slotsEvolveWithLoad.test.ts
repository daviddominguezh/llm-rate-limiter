/**
 * Test suite: Slots Evolve With Load
 *
 * Verifies that calculated slots evolve properly over time
 * as load increases and decreases.
 *
 * Uses the slotCalculation config preset:
 * - model-alpha: 100K TPM
 * - model-beta: 100K TPM
 * - jobTypeA: 10K tokens, ratio 0.6
 * - jobTypeB: 5K tokens, ratio 0.4
 *
 * Key behaviors to verify:
 * 1. When jobs are acquired, available slots decrease
 * 2. When jobs complete, available slots increase (slots freed up)
 * 3. New jobs can use the freed slots immediately
 * 4. The system correctly manages slot count over multiple acquire/release cycles
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { sleep } from '../testUtils.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With slotCalculation config and 2 instances:
// jobTypeA: floor((100K/10K) / 2 * 0.6) = 3 slots per instance = 6 total
// jobTypeB: floor((100K/5K) / 2 * 0.4) = 4 slots per instance = 8 total
const JOB_TYPE_A_TOTAL_SLOTS = 6;
const JOB_TYPE_B_TOTAL_SLOTS = 8;

const SHORT_JOB_DURATION_MS = 100;
const MEDIUM_JOB_DURATION_MS = 1000;
const LONG_JOB_DURATION_MS = 5000;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 180000;
const CONFIG_PRESET: ConfigPresetName = 'slotCalculation';

describe('Slots Evolve With Load', () => {
  describe('Sequential Acquire and Release', () => {
    /**
     * Scenario:
     * 1. Send batch of jobs that fills capacity
     * 2. Wait for them to complete (slots freed)
     * 3. Send another batch of same size
     * 4. Should complete without issues because slots were freed
     */
    let data: TestData;

    beforeAll(async () => {
      // First batch: fill jobTypeA capacity
      const batch1 = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'evolve-batch1',
        durationMs: SHORT_JOB_DURATION_MS,
      });

      // Second batch: same number, should reuse freed slots
      const batch2 = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'evolve-batch2',
        durationMs: SHORT_JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'slots-evolve-sequential',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        // Send all at once - first batch will fill slots, second batch will wait
        jobs: [...batch1, ...batch2],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobs from both batches', () => {
      const totalJobs = JOB_TYPE_A_TOTAL_SLOTS * 2;
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      expect(completedJobs.length).toBe(totalJobs);
    });

    it('should complete first batch quickly', () => {
      const batch1Jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('evolve-batch1'));
      const completed1 = batch1Jobs.filter((j) => j.status === 'completed');
      expect(completed1.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);

      // First batch should complete without significant queue wait
      for (const job of batch1Jobs) {
        const queueDuration = job.queueDurationMs ?? 0;
        expect(queueDuration).toBeLessThan(1000);
      }
    });

    it('should complete second batch after slots are freed', () => {
      const batch2Jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('evolve-batch2'));
      const completed2 = batch2Jobs.filter((j) => j.status === 'completed');
      expect(completed2.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Concurrent Load with Slot Reuse', () => {
    /**
     * Scenario:
     * 1. Send long-running jobs to fill some slots
     * 2. Send short jobs that will need to wait for slots
     * 3. As long jobs complete, short jobs should acquire freed slots
     */
    let data: TestData;

    beforeAll(async () => {
      // Long-running jobs to occupy slots
      const longJobs = generateJobsOfType(3, 'jobTypeA', {
        prefix: 'long-occupy',
        durationMs: LONG_JOB_DURATION_MS,
      });

      // Short jobs that will need to wait initially, then use freed slots
      const shortJobs = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'short-wait',
        durationMs: SHORT_JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'slots-evolve-concurrent',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...longJobs, ...shortJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all long-running jobs', () => {
      const longJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('long-occupy'));
      const completed = longJobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(3);
    });

    it('should complete all short jobs after slots freed', () => {
      const shortJobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('short-wait'));
      const completed = shortJobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Multiple Job Types with Interleaved Load', () => {
    /**
     * Scenario:
     * 1. Fill jobTypeA slots
     * 2. Fill jobTypeB slots
     * 3. As jobs complete, send more of each type
     * 4. Both types should correctly manage their independent slot pools
     */
    let data: TestData;

    beforeAll(async () => {
      // Fill both job types
      const typeAJobs = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'interleave-a',
        durationMs: MEDIUM_JOB_DURATION_MS,
      });

      const typeBJobs = generateJobsOfType(JOB_TYPE_B_TOTAL_SLOTS, 'jobTypeB', {
        prefix: 'interleave-b',
        durationMs: MEDIUM_JOB_DURATION_MS,
      });

      // Additional jobs that will wait for slots
      const moreAJobs = generateJobsOfType(3, 'jobTypeA', {
        prefix: 'more-a',
        durationMs: SHORT_JOB_DURATION_MS,
      });

      const moreBJobs = generateJobsOfType(3, 'jobTypeB', {
        prefix: 'more-b',
        durationMs: SHORT_JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'slots-evolve-interleaved',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...typeAJobs, ...typeBJobs, ...moreAJobs, ...moreBJobs],
        waitTimeoutMs: WAIT_TIMEOUT_MS * 2,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobTypeA jobs', () => {
      const typeAJobs = Object.values(data.jobs).filter(
        (j) => j.jobId.startsWith('interleave-a') || j.jobId.startsWith('more-a')
      );
      const completed = typeAJobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(JOB_TYPE_A_TOTAL_SLOTS + 3);
    });

    it('should complete all jobTypeB jobs', () => {
      const typeBJobs = Object.values(data.jobs).filter(
        (j) => j.jobId.startsWith('interleave-b') || j.jobId.startsWith('more-b')
      );
      const completed = typeBJobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(JOB_TYPE_B_TOTAL_SLOTS + 3);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });

    it('should distribute roughly evenly across both instances', () => {
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(2);

      // Calculate total jobs and expected per instance
      const totalJobs = JOB_TYPE_A_TOTAL_SLOTS + 3 + JOB_TYPE_B_TOTAL_SLOTS + 3;
      const expectedPerInstance = totalJobs / 2;
      const tolerance = expectedPerInstance * 0.3; // Allow 30% variance

      // Each instance should have roughly half the jobs (within tolerance)
      for (const instanceId of instanceIds) {
        const stats = data.summary.byInstance[instanceId];
        const jobCount = stats?.total ?? 0;

        expect(jobCount).toBeGreaterThan(expectedPerInstance - tolerance);
        expect(jobCount).toBeLessThan(expectedPerInstance + tolerance);
      }
    });
  });
});
