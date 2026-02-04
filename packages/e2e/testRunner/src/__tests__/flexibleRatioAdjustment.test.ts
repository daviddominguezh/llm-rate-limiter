/**
 * Test suite: Flexible Ratio Adjustment
 *
 * Verifies that flexible job types have their ratios adjusted
 * based on load using the donor/receiver algorithm.
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: 10K tokens each, ratio ~0.33 each, all flexible
 *
 * Expected behavior:
 * - When one job type is overloaded and others are idle, ratios shift
 * - Idle job types (donors) give ratio to overloaded job types (receivers)
 * - Total ratio always sums to 1.0
 *
 * Note: Ratio adjustment is LOCAL to each instance (not shared across instances).
 * This is the intended behavior - each instance manages its own load balance.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// With flexibleRatio config and 2 instances:
// Each job type starts with ~0.33 ratio = floor((100K/10K) / 2 * 0.33) = ~1-2 slots per instance
// Total: ~3 slots per job type (6-9 total across all types)
const INITIAL_SLOTS_PER_TYPE = 3;

const JOB_DURATION_MS = 100;
const LONGER_JOB_DURATION_MS = 2000; // Longer jobs to keep slots occupied
const WAIT_TIMEOUT_MS = 90000;
const BEFORE_ALL_TIMEOUT_MS = 180000;
const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

describe('Flexible Ratio Adjustment', () => {
  describe('All Flexible Job Types Complete', () => {
    /**
     * Basic test: All flexible job types with equal initial ratios
     * should be able to complete their allocated jobs.
     */
    let data: TestData;

    beforeAll(async () => {
      // Send a few jobs of each type
      const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobA', {
        prefix: 'flex-a',
        durationMs: JOB_DURATION_MS,
      });

      const jobsB = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobB', {
        prefix: 'flex-b',
        durationMs: JOB_DURATION_MS,
      });

      const jobsC = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobC', {
        prefix: 'flex-c',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'flexible-ratio-basic',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsA, ...jobsB, ...jobsC],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all flexJobA jobs', () => {
      const jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flex-a'));
      const completed = jobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(INITIAL_SLOTS_PER_TYPE);
    });

    it('should complete all flexJobB jobs', () => {
      const jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flex-b'));
      const completed = jobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(INITIAL_SLOTS_PER_TYPE);
    });

    it('should complete all flexJobC jobs', () => {
      const jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('flex-c'));
      const completed = jobs.filter((j) => j.status === 'completed');
      expect(completed.length).toBe(INITIAL_SLOTS_PER_TYPE);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Load Imbalance Handling', () => {
    /**
     * Scenario:
     * 1. Send many jobs of flexJobA (high load)
     * 2. Send no jobs of flexJobB and flexJobC (idle)
     * 3. flexJobA should be able to handle more than its initial allocation
     *    because flexJobB and flexJobC donate their unused capacity
     */
    let data: TestData;

    beforeAll(async () => {
      // Send more jobs of flexJobA than its initial allocation
      // The local ratio adjustment should allow more capacity for A
      const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE * 2, 'flexJobA', {
        prefix: 'imbalance-a',
        durationMs: JOB_DURATION_MS,
      });

      // Send minimal jobs of B and C
      const jobsB = generateJobsOfType(1, 'flexJobB', {
        prefix: 'imbalance-b',
        durationMs: JOB_DURATION_MS,
      });

      const jobsC = generateJobsOfType(1, 'flexJobC', {
        prefix: 'imbalance-c',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'flexible-ratio-imbalance',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsA, ...jobsB, ...jobsC],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all flexJobA jobs', () => {
      const jobs = Object.values(data.jobs).filter((j) => j.jobId.startsWith('imbalance-a'));
      const completed = jobs.filter((j) => j.status === 'completed');
      // All jobs should eventually complete as ratios adjust
      expect(completed.length).toBe(INITIAL_SLOTS_PER_TYPE * 2);
    });

    it('should complete flexJobB and flexJobC jobs', () => {
      const jobsB = Object.values(data.jobs).filter((j) => j.jobId.startsWith('imbalance-b'));
      const jobsC = Object.values(data.jobs).filter((j) => j.jobId.startsWith('imbalance-c'));

      expect(jobsB.filter((j) => j.status === 'completed').length).toBe(1);
      expect(jobsC.filter((j) => j.status === 'completed').length).toBe(1);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Ratio Adjustment Under Concurrent Load', () => {
    /**
     * Scenario:
     * 1. Send long-running jobs of flexJobB to keep it busy
     * 2. Send many short jobs of flexJobA
     * 3. flexJobA should complete quickly as it gets more capacity from idle flexJobC
     */
    let data: TestData;

    beforeAll(async () => {
      // Send long-running jobs of B to occupy its slots
      const jobsB = generateJobsOfType(INITIAL_SLOTS_PER_TYPE, 'flexJobB', {
        prefix: 'concurrent-b',
        durationMs: LONGER_JOB_DURATION_MS,
      });

      // Send many short jobs of A
      const jobsA = generateJobsOfType(INITIAL_SLOTS_PER_TYPE * 2, 'flexJobA', {
        prefix: 'concurrent-a',
        durationMs: JOB_DURATION_MS,
      });

      // No jobs for C (should donate capacity)

      data = await runSuite({
        suiteName: 'flexible-ratio-concurrent',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsB, ...jobsA],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
        sendJobsInParallel: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobs', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      const totalJobs = INITIAL_SLOTS_PER_TYPE + INITIAL_SLOTS_PER_TYPE * 2;
      expect(completedJobs.length).toBe(totalJobs);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });
});
