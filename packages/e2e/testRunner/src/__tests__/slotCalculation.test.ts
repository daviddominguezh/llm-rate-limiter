/**
 * Test suite: Slot Calculation Correctness
 *
 * Verifies that the multi-dimensional slot calculation works correctly
 * with different models, job types, and instance counts.
 *
 * Uses the slotCalculation config preset:
 * - model-alpha: 100K TPM
 * - model-beta: 100K TPM
 * - jobTypeA: 10K tokens, ratio 0.6
 * - jobTypeB: 5K tokens, ratio 0.4
 *
 * Expected slots with 2 instances:
 * - model-alpha, jobTypeA: floor((100K/10K) / 2 * 0.6) = floor(5 * 0.6) = 3
 * - model-alpha, jobTypeB: floor((100K/5K) / 2 * 0.4) = floor(10 * 0.4) = 4
 * - model-beta, jobTypeA: floor((100K/10K) / 2 * 0.6) = floor(5 * 0.6) = 3
 * - model-beta, jobTypeB: floor((100K/5K) / 2 * 0.4) = floor(10 * 0.4) = 4
 *
 * Total slots per instance:
 * - jobTypeA: 3 (model-alpha) + 3 (model-beta) = 6 total across both models
 * - jobTypeB: 4 (model-alpha) + 4 (model-beta) = 8 total across both models
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With 2 instances and slotCalculation config:
// jobTypeA: 3 slots per instance on model-alpha = 6 total across both instances
// jobTypeB: 4 slots per instance on model-alpha = 8 total across both instances
const JOB_TYPE_A_SLOTS_PER_INSTANCE = 3;
const JOB_TYPE_B_SLOTS_PER_INSTANCE = 4;
const INSTANCE_COUNT = 2;
const JOB_TYPE_A_TOTAL_SLOTS = JOB_TYPE_A_SLOTS_PER_INSTANCE * INSTANCE_COUNT;
const JOB_TYPE_B_TOTAL_SLOTS = JOB_TYPE_B_SLOTS_PER_INSTANCE * INSTANCE_COUNT;

const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;

describe('Slot Calculation Correctness', () => {
  describe('Multi-Job-Type Distribution', () => {
    let data: TestData;

    beforeAll(async () => {
      // Send jobs of both types up to their calculated capacity
      const jobsA = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'slot-calc-a',
        durationMs: JOB_DURATION_MS,
      });

      const jobsB = generateJobsOfType(JOB_TYPE_B_TOTAL_SLOTS, 'jobTypeB', {
        prefix: 'slot-calc-b',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'slot-calculation',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsA, ...jobsB],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: 'slotCalculation',
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should send all jobs', () => {
      expect(Object.keys(data.jobs).length).toBe(JOB_TYPE_A_TOTAL_SLOTS + JOB_TYPE_B_TOTAL_SLOTS);
    });

    it('should complete all jobs without failures', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');

      expect(failedJobs.length).toBe(0);
      expect(completedJobs.length).toBe(JOB_TYPE_A_TOTAL_SLOTS + JOB_TYPE_B_TOTAL_SLOTS);
    });

    it('should complete all jobTypeA jobs', () => {
      const jobsA = Object.values(data.jobs).filter((j) => j.jobId.startsWith('slot-calc-a'));
      const completedA = jobsA.filter((j) => j.status === 'completed');
      expect(completedA.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);
    });

    it('should complete all jobTypeB jobs', () => {
      const jobsB = Object.values(data.jobs).filter((j) => j.jobId.startsWith('slot-calc-b'));
      const completedB = jobsB.filter((j) => j.status === 'completed');
      expect(completedB.length).toBe(JOB_TYPE_B_TOTAL_SLOTS);
    });

    it('should use the primary model for all jobs', () => {
      // All jobs should complete on model-alpha (primary in escalation order)
      const jobsOnPrimary = Object.values(data.jobs).filter((j) => j.modelUsed === 'model-alpha');
      expect(jobsOnPrimary.length).toBe(JOB_TYPE_A_TOTAL_SLOTS + JOB_TYPE_B_TOTAL_SLOTS);
    });

    it('should distribute jobs evenly across both instances', () => {
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(INSTANCE_COUNT);

      // Each instance should have roughly half the jobs
      const totalJobs = JOB_TYPE_A_TOTAL_SLOTS + JOB_TYPE_B_TOTAL_SLOTS;
      const expectedPerInstance = totalJobs / INSTANCE_COUNT;

      for (const instanceId of instanceIds) {
        const instanceStats = data.summary.byInstance[instanceId];
        expect(instanceStats).toBeDefined();
        expect(instanceStats?.total).toBe(expectedPerInstance);
      }
    });
  });

  describe('Independent Job Type Capacity', () => {
    let data: TestData;

    beforeAll(async () => {
      // Fill jobTypeA capacity completely, then send jobTypeB jobs
      // jobTypeB should still run because it has its own independent slots
      const jobsA = generateJobsOfType(JOB_TYPE_A_TOTAL_SLOTS, 'jobTypeA', {
        prefix: 'independent-a',
        durationMs: JOB_DURATION_MS,
      });

      // Send just 2 jobTypeB jobs to verify they can run independently
      const jobsB = generateJobsOfType(2, 'jobTypeB', {
        prefix: 'independent-b',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'independent-capacity',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsA, ...jobsB],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: 'slotCalculation',
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobTypeA jobs', () => {
      const jobsA = Object.values(data.jobs).filter((j) => j.jobId.startsWith('independent-a'));
      const completedA = jobsA.filter((j) => j.status === 'completed');
      expect(completedA.length).toBe(JOB_TYPE_A_TOTAL_SLOTS);
    });

    it('should complete jobTypeB jobs despite jobTypeA being at capacity', () => {
      const jobsB = Object.values(data.jobs).filter((j) => j.jobId.startsWith('independent-b'));
      const completedB = jobsB.filter((j) => j.status === 'completed');

      // Key assertion: jobTypeB jobs complete even though jobTypeA filled its capacity
      expect(completedB.length).toBe(2);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });
});
