/**
 * Test suite: Instance Scaling
 *
 * Verifies that slots are properly redistributed when instances join and leave.
 *
 * Uses the instanceScaling config preset:
 * - scale-model: 100K TPM
 * - scaleJob: 10K tokens, ratio 1.0
 *
 * Expected slots:
 * - With 1 instance: floor((100K/10K) / 1 * 1.0) = 10 slots
 * - With 2 instances: floor((100K/10K) / 2 * 1.0) = 5 slots per instance
 *
 * Key behaviors to verify:
 * 1. When instance B joins after A, A's slots halve (from 10 to 5)
 * 2. When instance B disconnects, A's slots double (back to 10)
 * 3. Total capacity across all instances stays constant
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName, resetInstance } from '../resetInstance.js';
import { StateAggregator } from '../stateAggregator.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { sleep } from '../testUtils.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_A_URL = 'http://localhost:3001';
const INSTANCE_B_URL = 'http://localhost:3002';
const INSTANCE_URLS = [INSTANCE_A_URL, INSTANCE_B_URL];

// With instanceScaling config:
// scaleJob: floor((100K/10K) / instanceCount * 1.0)
// With 1 instance: 10 slots
// With 2 instances: 5 slots per instance
const SLOTS_WITH_ONE_INSTANCE = 10;
const SLOTS_WITH_TWO_INSTANCES = 5;
const TOTAL_CAPACITY = 10;

const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;
const ALLOCATION_PROPAGATION_MS = 1000;
const CONFIG_PRESET: ConfigPresetName = 'instanceScaling';

describe('Instance Scaling', () => {
  describe('Total Capacity Remains Constant', () => {
    let data: TestData;

    beforeAll(async () => {
      // Send exactly the total capacity worth of jobs across 2 instances
      // If slots are distributed correctly, all jobs should complete
      const jobs = generateJobsOfType(TOTAL_CAPACITY, 'scaleJob', {
        prefix: 'scaling-test',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'instance-scaling-total',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        proxyRatio: '1:1',
        configPreset: CONFIG_PRESET,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should send all jobs', () => {
      expect(Object.keys(data.jobs).length).toBe(TOTAL_CAPACITY);
    });

    it('should complete all jobs without failures', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');

      expect(failedJobs.length).toBe(0);
      expect(completedJobs.length).toBe(TOTAL_CAPACITY);
    });

    it('should distribute jobs across both instances', () => {
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(2);

      // Each instance should have approximately half the jobs
      for (const instanceId of instanceIds) {
        const instanceStats = data.summary.byInstance[instanceId];
        expect(instanceStats).toBeDefined();
        expect(instanceStats?.total).toBe(SLOTS_WITH_TWO_INSTANCES);
      }
    });
  });

  describe('Instance Join Halves Slots', () => {
    /**
     * Scenario:
     * 1. Instance A starts alone and registers (gets 10 slots)
     * 2. Instance B joins (both get 5 slots each)
     * 3. Send jobs and verify distribution reflects the scaled allocation
     */
    let data: TestData;
    let aggregator: StateAggregator;

    beforeAll(async () => {
      // Reset proxy first
      await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });
      await fetch(`${PROXY_URL}/proxy/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio: '1:1' }),
      });

      // Start instance A first (with Redis cleanup)
      const resultA = await resetInstance(INSTANCE_A_URL, {
        cleanRedis: true,
        configPreset: CONFIG_PRESET,
      });
      expect(resultA.success).toBe(true);

      // Wait for A to be fully registered and get full allocation
      await sleep(ALLOCATION_PROPAGATION_MS);

      // Now start instance B (no Redis cleanup - joins existing cluster)
      const resultB = await resetInstance(INSTANCE_B_URL, {
        cleanRedis: false,
        configPreset: CONFIG_PRESET,
      });
      expect(resultB.success).toBe(true);

      // Wait for reallocation to propagate
      await sleep(ALLOCATION_PROPAGATION_MS);

      // Create aggregator to observe state
      aggregator = new StateAggregator(INSTANCE_URLS);

      // Send jobs to fill the total capacity
      const jobs = generateJobsOfType(TOTAL_CAPACITY, 'scaleJob', {
        prefix: 'join-test',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'instance-join-halves',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        saveToFile: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobs', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      expect(completedJobs.length).toBe(TOTAL_CAPACITY);
    });

    it('should distribute jobs evenly after B joins', () => {
      // After B joins, both instances should have 5 slots each
      // Jobs should be distributed roughly evenly
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(2);

      for (const instanceId of instanceIds) {
        const stats = data.summary.byInstance[instanceId];
        expect(stats?.total).toBe(SLOTS_WITH_TWO_INSTANCES);
      }
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });

  describe('Instance Leave Doubles Slots', () => {
    /**
     * Scenario:
     * 1. Both instances are running (5 slots each)
     * 2. Instance B disconnects
     * 3. Instance A should get all 10 slots
     * 4. Send jobs to A and verify it can handle the full capacity
     *
     * Note: This test simulates B leaving by only resetting A and not B
     */
    let data: TestData;

    beforeAll(async () => {
      // Reset proxy
      await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });
      // Route all jobs to instance A only
      await fetch(`${PROXY_URL}/proxy/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio: '1:0' }),
      });

      // Clean Redis and start only instance A
      const resultA = await resetInstance(INSTANCE_A_URL, {
        cleanRedis: true,
        configPreset: CONFIG_PRESET,
      });
      expect(resultA.success).toBe(true);

      // Wait for allocation (A should get full capacity as only instance)
      await sleep(ALLOCATION_PROPAGATION_MS);

      // Send jobs to fill the capacity that one instance should have
      const jobs = generateJobsOfType(SLOTS_WITH_ONE_INSTANCE, 'scaleJob', {
        prefix: 'leave-test',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'instance-leave-doubles',
        proxyUrl: PROXY_URL,
        instanceUrls: [INSTANCE_A_URL], // Only one instance
        jobs,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        saveToFile: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobs on single instance', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      expect(completedJobs.length).toBe(SLOTS_WITH_ONE_INSTANCE);
    });

    it('should handle full capacity on single instance', () => {
      // Single instance should have gotten 10 slots (not 5)
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(1);

      const stats = data.summary.byInstance[instanceIds[0] ?? ''];
      expect(stats?.total).toBe(SLOTS_WITH_ONE_INSTANCE);
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });
});
