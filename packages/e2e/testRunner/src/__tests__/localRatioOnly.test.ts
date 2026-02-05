/**
 * Test suite: Dynamic Ratio is Local Only (Pool-Based)
 *
 * Verifies that dynamic ratio adjustments are NOT shared across instances.
 * Each instance maintains its own local ratio state for job type distribution.
 *
 * With pool-based allocation:
 * - Redis provides per-model pools to each instance
 * - Each instance locally distributes pool capacity across job types using ratios
 * - Ratio adjustments on one instance don't affect other instances' allocations
 *
 * Uses the flexibleRatio config preset:
 * - flex-model: 100K TPM
 * - flexJobA, flexJobB, flexJobC: Each gets a share of the pool locally
 *
 * Key behavior to verify:
 * - Instance A's ratio adjustments don't affect Instance B's pools
 * - Each instance independently manages its own load balance
 * - Heavy load on Instance A doesn't reduce Instance B's pool capacity
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { type ConfigPresetName, resetInstance } from '../resetInstance.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { sleep } from '../testUtils.js';

interface ModelPoolAllocation {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

interface PoolsData {
  [modelId: string]: ModelPoolAllocation;
}

interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: {
    instanceCount: number;
    pools: PoolsData;
  } | null;
}

/**
 * Fetch allocation from an instance.
 */
const fetchAllocation = async (baseUrl: string): Promise<AllocationResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/allocation`);
  return response.json() as Promise<AllocationResponse>;
};

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_A_URL = 'http://localhost:3001';
const INSTANCE_B_URL = 'http://localhost:3002';
const INSTANCE_URLS = [INSTANCE_A_URL, INSTANCE_B_URL];

const JOB_DURATION_MS = 100;
const LONG_JOB_DURATION_MS = 3000; // Long enough to trigger ratio adjustment
const WAIT_TIMEOUT_MS = 120000;
const BEFORE_ALL_TIMEOUT_MS = 240000;
const ALLOCATION_PROPAGATION_MS = 1000;
const CONFIG_PRESET: ConfigPresetName = 'flexibleRatio';

describe('Dynamic Ratio is Local Only (Pool-Based)', () => {
  describe('Independent Instance Ratio Management', () => {
    /**
     * Scenario:
     * 1. Both instances start with equal pool allocations
     * 2. Send heavy load of flexJobA to Instance A (may trigger local ratio adjustment on A)
     * 3. Send flexJobB jobs to Instance B
     * 4. Instance B's pool capacity should NOT be affected by A's ratio changes
     *
     * Expected:
     * - Instance A adjusts its local ratios due to high flexJobA load
     * - Instance B maintains its pool allocation from Redis
     * - Instance B can still handle flexJobB jobs at its pool capacity
     */
    let dataA: TestData;
    let dataB: TestData;

    beforeAll(async () => {
      // Reset proxy
      await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });

      // Reset both instances with flexibleRatio config
      const resultA = await resetInstance(INSTANCE_A_URL, {
        cleanRedis: true,
        configPreset: CONFIG_PRESET,
      });
      expect(resultA.success).toBe(true);

      const resultB = await resetInstance(INSTANCE_B_URL, {
        cleanRedis: false,
        configPreset: CONFIG_PRESET,
      });
      expect(resultB.success).toBe(true);

      // Wait for allocation to propagate
      await sleep(ALLOCATION_PROPAGATION_MS);

      // Phase 1: Send heavy load to Instance A with long-running flexJobA jobs
      // This should trigger ratio adjustment on Instance A
      await fetch(`${PROXY_URL}/proxy/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio: '1:0' }), // All to Instance A
      });

      const heavyJobsA = generateJobsOfType(6, 'flexJobA', {
        prefix: 'heavy-a',
        durationMs: LONG_JOB_DURATION_MS,
      });

      // Send heavy jobs to A
      dataA = await runSuite({
        suiteName: 'local-ratio-phase-a',
        proxyUrl: PROXY_URL,
        instanceUrls: [INSTANCE_A_URL],
        jobs: heavyJobsA,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        saveToFile: true,
        sendJobsInParallel: true,
      });

      // Phase 2: While A is busy, send jobs to Instance B
      // B's pool allocation should be independent of A's local adjustments
      await fetch(`${PROXY_URL}/proxy/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio: '0:1' }), // All to Instance B
      });

      const jobsB = generateJobsOfType(3, 'flexJobB', {
        prefix: 'independent-b',
        durationMs: JOB_DURATION_MS,
      });

      dataB = await runSuite({
        suiteName: 'local-ratio-phase-b',
        proxyUrl: PROXY_URL,
        instanceUrls: [INSTANCE_B_URL],
        jobs: jobsB,
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        saveToFile: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete Instance A jobs', () => {
      const completedA = Object.values(dataA.jobs).filter((j) => j.status === 'completed');
      expect(completedA.length).toBe(6);
    });

    it('should complete Instance B jobs independently', () => {
      const completedB = Object.values(dataB.jobs).filter((j) => j.status === 'completed');
      // B should complete its jobs because its pools are not affected by A's load
      expect(completedB.length).toBe(3);
    });

    it('Instance B jobs should complete quickly', () => {
      const jobsB = Object.values(dataB.jobs);

      // Instance B's flexJobB jobs should not be delayed by Instance A's load
      for (const job of jobsB) {
        const queueDuration = job.queueDurationMs ?? 0;
        // Should complete relatively quickly (not waiting for A)
        expect(queueDuration).toBeLessThan(5000);
      }
    });

    it('should not have any failed jobs on either instance', () => {
      const failedA = Object.values(dataA.jobs).filter((j) => j.status === 'failed');
      const failedB = Object.values(dataB.jobs).filter((j) => j.status === 'failed');
      expect(failedA.length).toBe(0);
      expect(failedB.length).toBe(0);
    });
  });

  describe('Pool Allocation Verification - Pools Are Shared, Ratios Are Local', () => {
    /**
     * Direct verification that each instance receives the same pool allocation from Redis.
     * After heavy load on Instance A, we verify that:
     * 1. Both instances have valid pool allocation data
     * 2. Both instances receive the same pools from Redis
     * 3. Instance B's pools are not reduced by Instance A's load
     *
     * Note: Local ratio distribution happens within each instance independently.
     */
    beforeAll(async () => {
      // Reset proxy
      await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });

      // Reset both instances with flexibleRatio config
      await resetInstance(INSTANCE_A_URL, {
        cleanRedis: true,
        configPreset: CONFIG_PRESET,
      });

      await resetInstance(INSTANCE_B_URL, {
        cleanRedis: false,
        configPreset: CONFIG_PRESET,
      });

      // Wait for allocation to propagate
      await sleep(ALLOCATION_PROPAGATION_MS);
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should have pool allocation data on both instances', async () => {
      const allocA = await fetchAllocation(INSTANCE_A_URL);
      const allocB = await fetchAllocation(INSTANCE_B_URL);

      expect(allocA.allocation).not.toBeNull();
      expect(allocB.allocation).not.toBeNull();
      expect(allocA.allocation?.pools).toBeDefined();
      expect(allocB.allocation?.pools).toBeDefined();
    });

    it('should report same instance count on both instances', async () => {
      const allocA = await fetchAllocation(INSTANCE_A_URL);
      const allocB = await fetchAllocation(INSTANCE_B_URL);

      expect(allocA.allocation?.instanceCount).toBe(2);
      expect(allocB.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for flex-model', async () => {
      const allocA = await fetchAllocation(INSTANCE_A_URL);
      const allocB = await fetchAllocation(INSTANCE_B_URL);

      // Both instances should have the same pool allocation from Redis
      const poolA = allocA.allocation?.pools?.['flex-model'];
      const poolB = allocB.allocation?.pools?.['flex-model'];

      expect(poolA).toBeDefined();
      expect(poolB).toBeDefined();
      expect(poolA?.totalSlots).toBe(poolB?.totalSlots);
      expect(poolA?.tokensPerMinute).toBe(poolB?.tokensPerMinute);
    });

    it(
      'Instance B should maintain pool allocation after Instance A processes heavy load',
      async () => {
        // Get baseline pool allocation for Instance B
        const baselineB = await fetchAllocation(INSTANCE_B_URL);
        const baselinePoolB = baselineB.allocation?.pools?.['flex-model'];

        // Send heavy load to Instance A only
        await fetch(`${PROXY_URL}/proxy/ratio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ratio: '1:0' }),
        });

        const heavyJobs = generateJobsOfType(6, 'flexJobA', {
          prefix: 'alloc-verify',
          durationMs: LONG_JOB_DURATION_MS,
        });

        await runSuite({
          suiteName: 'local-ratio-alloc-verify',
          proxyUrl: PROXY_URL,
          instanceUrls: [INSTANCE_A_URL],
          jobs: heavyJobs,
          waitTimeoutMs: WAIT_TIMEOUT_MS,
          sendJobsInParallel: true,
        });

        // After heavy load on A, verify B's pool allocation is NOT reduced
        const afterLoadB = await fetchAllocation(INSTANCE_B_URL);
        const afterPoolB = afterLoadB.allocation?.pools?.['flex-model'];

        // Instance B's pool allocation should be unchanged (ratios are local)
        // Pool slots might change due to dynamic limits, but shouldn't decrease due to A's local load
        expect(afterPoolB?.totalSlots).toBeGreaterThanOrEqual(baselinePoolB?.totalSlots ?? 0);
      },
      BEFORE_ALL_TIMEOUT_MS
    );
  });

  describe('Mixed Load Across Instances', () => {
    /**
     * Scenario:
     * 1. Both instances receive different types of load simultaneously
     * 2. Instance A: heavy flexJobA load
     * 3. Instance B: heavy flexJobB load
     * 4. Each instance should handle its load using its local ratio distribution
     */
    let data: TestData;

    beforeAll(async () => {
      // Reset proxy to distribute evenly by job type
      await fetch(`${PROXY_URL}/proxy/reset`, { method: 'POST' });
      await fetch(`${PROXY_URL}/proxy/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratio: '1:1' }),
      });

      // Reset both instances
      const resultA = await resetInstance(INSTANCE_A_URL, {
        cleanRedis: true,
        configPreset: CONFIG_PRESET,
      });
      expect(resultA.success).toBe(true);

      const resultB = await resetInstance(INSTANCE_B_URL, {
        cleanRedis: false,
        configPreset: CONFIG_PRESET,
      });
      expect(resultB.success).toBe(true);

      await sleep(ALLOCATION_PROPAGATION_MS);

      // Send mixed jobs that will be distributed across instances
      const jobsA = generateJobsOfType(4, 'flexJobA', {
        prefix: 'mixed-a',
        durationMs: JOB_DURATION_MS,
      });

      const jobsB = generateJobsOfType(4, 'flexJobB', {
        prefix: 'mixed-b',
        durationMs: JOB_DURATION_MS,
      });

      const jobsC = generateJobsOfType(4, 'flexJobC', {
        prefix: 'mixed-c',
        durationMs: JOB_DURATION_MS,
      });

      data = await runSuite({
        suiteName: 'local-ratio-mixed',
        proxyUrl: PROXY_URL,
        instanceUrls: INSTANCE_URLS,
        jobs: [...jobsA, ...jobsB, ...jobsC],
        waitTimeoutMs: WAIT_TIMEOUT_MS,
        saveToFile: true,
      });
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should complete all jobs', () => {
      const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
      expect(completedJobs.length).toBe(12); // 4 + 4 + 4
    });

    it('should distribute jobs across both instances', () => {
      const instanceIds = Object.keys(data.summary.byInstance);
      expect(instanceIds.length).toBe(2);

      // Each instance should have some jobs
      for (const instanceId of instanceIds) {
        const stats = data.summary.byInstance[instanceId];
        expect(stats?.total).toBeGreaterThan(0);
      }
    });

    it('should not have any failed jobs', () => {
      const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
      expect(failedJobs.length).toBe(0);
    });
  });
});
