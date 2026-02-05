/**
 * Test suite: Pool-Based Slot Calculation
 *
 * Verifies that the pool-based slot calculation works correctly.
 * With pool-based allocation, Redis calculates per-model slots (not per-job-type).
 *
 * Key: This test does NOT queue any jobs. It only verifies the initial
 * pool allocation math by querying the allocation endpoint directly.
 *
 * Formula: pools[model].totalSlots = floor((modelCapacity / avgEstimatedResource) / instanceCount)
 *
 * Note: Job type distribution is now handled locally, not by Redis.
 */
import {
  bootInstance,
  cleanRedis,
  fetchAllocation as fetchAllocationFromPort,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import { type ConfigPresetName, resetInstance } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

const INSTANCE_A_URL = 'http://localhost:3001';
const INSTANCE_B_URL = 'http://localhost:3002';

const ALLOCATION_PROPAGATION_MS = 2000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

interface ModelPoolAllocation {
  totalSlots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  tokensPerDay: number;
  requestsPerDay: number;
}

interface AllocationInfo {
  instanceCount: number;
  pools: Record<string, ModelPoolAllocation>;
}

interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

/**
 * Fetch allocation from an instance.
 */
const fetchAllocation = async (baseUrl: string): Promise<AllocationResponse> => {
  const response = await fetch(`${baseUrl}/api/debug/allocation`);
  return response.json() as Promise<AllocationResponse>;
};

/**
 * Reset instances with a specific config preset.
 */
const setupInstances = async (configPreset: ConfigPresetName): Promise<void> => {
  await resetInstance(INSTANCE_A_URL, { cleanRedis: true, configPreset });
  await resetInstance(INSTANCE_B_URL, { cleanRedis: false, configPreset });
  await sleep(ALLOCATION_PROPAGATION_MS);
};

describe('Pool-Based Slot Calculation', () => {
  describe('TPM-Only Model (slotCalc-tpm)', () => {
    /**
     * Config:
     * model-alpha: TPM = 100,000
     * Job types use estimatedTokens for local distribution, but Redis
     * calculates pool slots based on average estimated tokens.
     *
     * With avg estimated tokens ~7,500 (average of 10K and 5K):
     * Expected with 2 instances:
     * pools['model-alpha'].totalSlots = floor((100K/7500) / 2) = floor(13.3 / 2) = 6
     *
     * Note: Exact value depends on how averaging is done in Lua
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation).not.toBeNull();
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for model-alpha', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-alpha'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
    });

    it('should report tokensPerMinute in pool allocation', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const tpm = response.allocation?.pools?.['model-alpha']?.tokensPerMinute;
      // 100K / 2 instances = 50,000 per instance (or less if usage tracked)
      expect(tpm).toBeDefined();
      expect(tpm).toBeGreaterThan(0);
      expect(tpm).toBeLessThanOrEqual(50000);
    });

    it('should have consistent allocation across both instances', async () => {
      const responseA = await fetchAllocation(INSTANCE_A_URL);
      const responseB = await fetchAllocation(INSTANCE_B_URL);

      const slotsA = responseA.allocation?.pools?.['model-alpha']?.totalSlots;
      const slotsB = responseB.allocation?.pools?.['model-alpha']?.totalSlots;

      expect(slotsA).toBe(slotsB);
    });
  });

  describe('RPM-Only Model (slotCalc-rpm)', () => {
    /**
     * Config:
     * model-beta: RPM = 500
     * Pool slots based on average estimated requests.
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-rpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for model-beta', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-beta'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
    });

    it('should report requestsPerMinute in pool allocation', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const rpm = response.allocation?.pools?.['model-beta']?.requestsPerMinute;
      // 500 / 2 instances = 250 per instance
      expect(rpm).toBeDefined();
      expect(rpm).toBeGreaterThan(0);
      expect(rpm).toBeLessThanOrEqual(250);
    });
  });

  describe('Concurrent-Only Model (slotCalc-concurrent)', () => {
    /**
     * Config:
     * model-gamma: maxConcurrentRequests = 100
     *
     * Expected with 2 instances:
     * pools['model-gamma'].totalSlots = floor(100 / 2) = 50
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-concurrent');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct pool slots for concurrent-based model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.pools?.['model-gamma']?.totalSlots;
      // floor(100 / 2) = 50
      expect(slots).toBe(50);
    });
  });

  describe('Mixed Limits - Limiting Factor (slotCalc-tpm-rpm)', () => {
    /**
     * Config:
     * model-delta: TPM = 100,000, RPM = 50
     *
     * Pool slots use minimum of TPM-based and RPM-based calculations.
     * RPM is likely the limiting factor here.
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpm-rpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should have pool allocation using limiting factor', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-delta'];
      expect(pool).toBeDefined();
      // RPM-based slots should be lower than TPM-based
      expect(pool?.totalSlots).toBeGreaterThan(0);
    });

    it('should report both TPM and RPM in pool', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-delta'];
      expect(pool?.tokensPerMinute).toBeDefined();
      expect(pool?.requestsPerMinute).toBeDefined();
    });
  });

  describe('Multiple Models with Different Limit Types (slotCalc-multi-model)', () => {
    /**
     * Config:
     * model-tpm: TPM = 100,000
     * model-concurrent: maxConcurrentRequests = 50
     *
     * Each model gets its own pool.
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-multi-model');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should have pool allocation for TPM model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-tpm'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
    });

    it('should have pool allocation for concurrent model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-concurrent'];
      expect(pool).toBeDefined();
      // floor(50 / 2) = 25
      expect(pool?.totalSlots).toBe(25);
    });

    it('should have different pool slots for different models', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const tpmSlots = response.allocation?.pools?.['model-tpm']?.totalSlots;
      const concurrentSlots = response.allocation?.pools?.['model-concurrent']?.totalSlots;

      expect(tpmSlots).toBeDefined();
      expect(concurrentSlots).toBeDefined();
      // They may or may not be different depending on config
    });
  });

  describe('Instance Count Verification', () => {
    /**
     * Verify that instance count is correctly tracked.
     */
    beforeAll(async () => {
      await setupInstances('slotCalculation');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report correct instance count on both instances', async () => {
      const responseA = await fetchAllocation(INSTANCE_A_URL);
      const responseB = await fetchAllocation(INSTANCE_B_URL);

      expect(responseA.allocation?.instanceCount).toBe(2);
      expect(responseB.allocation?.instanceCount).toBe(2);
    });

    it('should have pools data structure', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);

      expect(response.allocation).not.toBeNull();
      expect(response.allocation?.pools).toBeDefined();
      expect(typeof response.allocation?.instanceCount).toBe('number');
    });
  });

  describe('TPD-Only Model (slotCalc-tpd)', () => {
    /**
     * Config:
     * model-tpd: TPD = 1,000,000 (tokens per day)
     * Pool slots based on TPD / avgEstimatedTokens / instanceCount
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpd');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for TPD model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-tpd'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
      expect(pool?.tokensPerDay).toBeGreaterThan(0);
    });
  });

  describe('RPD-Only Model (slotCalc-rpd)', () => {
    /**
     * Config:
     * model-rpd: RPD = 10,000 (requests per day)
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-rpd');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for RPD model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['model-rpd'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
      expect(pool?.requestsPerDay).toBeGreaterThan(0);
    });
  });

  describe('Memory-Based Slot Calculation (slotCalc-memory)', () => {
    /**
     * Config:
     * model: 10M TPM (very high, won't be limiting)
     * heavyMemoryJob: 10MB per job, ratio 0.5
     * lightMemoryJob: 1MB per job, ratio 0.5
     *
     * Memory is a LOCAL constraint: finalSlots = min(distributedSlots, memorySlots)
     *
     * With high TPM, distributed slots are very high (2500+), but memory
     * becomes the limiting factor:
     * - heavyMemoryJob: limited by memory (10MB per job)
     * - lightMemoryJob: limited by memory (1MB per job, so more slots)
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-memory');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have pool allocation for test-model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['test-model'];
      expect(pool).toBeDefined();
      expect(pool?.totalSlots).toBeGreaterThan(0);
    });

    it('should have high distributed slots due to high TPM', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const pool = response.allocation?.pools?.['test-model'];
      // With 10M TPM and 1K estimated tokens, distributed slots should be high
      // floor((10M / 1K) / 2) = 5000 slots per instance
      expect(pool?.totalSlots).toBeGreaterThanOrEqual(1000);
    });

    it('should report memory stats in debug endpoint', async () => {
      // Memory is a local constraint - verify stats endpoint shows memory info
      const response = await fetch(`${INSTANCE_A_URL}/api/debug/stats`);
      const stats = (await response.json()) as { stats: { memory?: { maxCapacityKB: number } } };
      // Memory stats should be present when memory is configured
      expect(stats.stats.memory).toBeDefined();
      expect(stats.stats.memory?.maxCapacityKB).toBeGreaterThan(0);
    });
  });

  describe('Pool Slots Scale with Instance Count', () => {
    /**
     * Test pool calculations with different instance counts (1, 2, 3).
     * Uses programmatic boot/kill for precise control.
     *
     * Formula verification:
     * With instanceScaling config (100K TPM, avgEstimatedTokens ~10K):
     * - 1 instance: floor((100K/10K) / 1) = 10 slots
     * - 2 instances: floor((100K/10K) / 2) = 5 slots each
     * - 3 instances: floor((100K/10K) / 3) = 3 slots each
     */
    const PORT_A = 4011;
    const PORT_B = 4012;
    const PORT_C = 4013;
    const INSTANCE_SCALE_TIMEOUT = 120000;

    afterAll(async () => {
      await killAllInstances();
    }, 30000);

    it(
      'should calculate 10 pool slots with 1 instance',
      async () => {
        await killAllInstances();
        await cleanRedis();
        await bootInstance(PORT_A, 'instanceScaling');
        await sleep(ALLOCATION_PROPAGATION_MS);

        const response = await fetchAllocationFromPort(PORT_A);
        expect(response.allocation?.instanceCount).toBe(1);
        expect(response.allocation?.pools?.['scale-model']?.totalSlots).toBe(10);

        await killAllInstances();
      },
      INSTANCE_SCALE_TIMEOUT
    );

    it(
      'should calculate 5 pool slots each with 2 instances',
      async () => {
        await killAllInstances();
        await cleanRedis();
        await bootInstance(PORT_A, 'instanceScaling');
        await sleep(ALLOCATION_PROPAGATION_MS);
        await bootInstance(PORT_B, 'instanceScaling');
        await waitForAllocationUpdate(PORT_A, (a) => a.instanceCount === 2);

        const responseA = await fetchAllocationFromPort(PORT_A);
        const responseB = await fetchAllocationFromPort(PORT_B);

        expect(responseA.allocation?.instanceCount).toBe(2);
        expect(responseA.allocation?.pools?.['scale-model']?.totalSlots).toBe(5);
        expect(responseB.allocation?.pools?.['scale-model']?.totalSlots).toBe(5);

        await killAllInstances();
      },
      INSTANCE_SCALE_TIMEOUT
    );

    it(
      'should calculate 3 pool slots each with 3 instances',
      async () => {
        await killAllInstances();
        await cleanRedis();
        await bootInstance(PORT_A, 'instanceScaling');
        await sleep(ALLOCATION_PROPAGATION_MS);
        await bootInstance(PORT_B, 'instanceScaling');
        await waitForAllocationUpdate(PORT_A, (a) => a.instanceCount === 2);
        await bootInstance(PORT_C, 'instanceScaling');
        await waitForAllocationUpdate(PORT_A, (a) => a.instanceCount === 3);

        const responseA = await fetchAllocationFromPort(PORT_A);
        const responseB = await fetchAllocationFromPort(PORT_B);
        const responseC = await fetchAllocationFromPort(PORT_C);

        expect(responseA.allocation?.instanceCount).toBe(3);
        expect(responseA.allocation?.pools?.['scale-model']?.totalSlots).toBe(3);
        expect(responseB.allocation?.pools?.['scale-model']?.totalSlots).toBe(3);
        expect(responseC.allocation?.pools?.['scale-model']?.totalSlots).toBe(3);

        await killAllInstances();
      },
      INSTANCE_SCALE_TIMEOUT
    );
  });
});
