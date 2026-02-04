/**
 * Test suite: Slot Calculation Correctness
 *
 * Verifies that the multi-dimensional slot calculation works correctly
 * with different models, job types, and instance counts.
 *
 * Key: This test does NOT queue any jobs. It only verifies the initial
 * slot allocation math by querying the allocation endpoint directly.
 *
 * Formula: slots[jobType][model] = floor((modelCapacity / estimatedResource) / instanceCount * ratio)
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

interface ModelSlotAllocation {
  slots: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
}

interface AllocationInfo {
  slots: number;
  instanceCount: number;
  slotsByJobTypeAndModel: Record<string, Record<string, ModelSlotAllocation>>;
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

describe('Slot Calculation Correctness', () => {
  describe('TPM-Only Model (slotCalc-tpm)', () => {
    /**
     * Config:
     * model-alpha: TPM = 100,000
     * jobTypeA: estimatedTokens = 10,000, ratio = 0.6
     * jobTypeB: estimatedTokens = 5,000, ratio = 0.4
     *
     * Expected with 2 instances:
     * jobTypeA: floor((100K/10K) / 2 * 0.6) = floor(5 * 0.6) = 3
     * jobTypeB: floor((100K/5K) / 2 * 0.4) = floor(10 * 0.4) = 4
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation).not.toBeNull();
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for jobTypeA', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots;
      // floor((100K/10K) / 2 * 0.6) = floor(5 * 0.6) = 3
      expect(slots).toBe(3);
    });

    it('should calculate correct slots for jobTypeB', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-alpha']?.slots;
      // floor((100K/5K) / 2 * 0.4) = floor(10 * 0.4) = 4
      expect(slots).toBe(4);
    });

    it('should report correct tokensPerMinute allocation', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const tpm = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.tokensPerMinute;
      // 100K / 2 instances = 50,000 per instance
      expect(tpm).toBe(50000);
    });

    it('should have consistent allocation across both instances', async () => {
      const responseA = await fetchAllocation(INSTANCE_A_URL);
      const responseB = await fetchAllocation(INSTANCE_B_URL);

      const slotsA = responseA.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots;
      const slotsB = responseB.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots;

      expect(slotsA).toBe(slotsB);
    });
  });

  describe('RPM-Only Model (slotCalc-rpm)', () => {
    /**
     * Config:
     * model-beta: RPM = 500
     * jobTypeA: estimatedRequests = 1, ratio = 0.6
     * jobTypeB: estimatedRequests = 5, ratio = 0.4
     *
     * Expected with 2 instances:
     * jobTypeA: floor((500/1) / 2 * 0.6) = floor(250 * 0.6) = 150
     * jobTypeB: floor((500/5) / 2 * 0.4) = floor(50 * 0.4) = 20
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-rpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for jobTypeA (RPM-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-beta']?.slots;
      // floor((500/1) / 2 * 0.6) = 150
      expect(slots).toBe(150);
    });

    it('should calculate correct slots for jobTypeB (RPM-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-beta']?.slots;
      // floor((500/5) / 2 * 0.4) = 20
      expect(slots).toBe(20);
    });

    it('should report correct requestsPerMinute allocation', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const rpm = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-beta']?.requestsPerMinute;
      // 500 / 2 instances = 250 per instance
      expect(rpm).toBe(250);
    });
  });

  describe('Concurrent-Only Model (slotCalc-concurrent)', () => {
    /**
     * Config:
     * model-gamma: maxConcurrentRequests = 100
     * jobTypeA: ratio = 0.7
     * jobTypeB: ratio = 0.3
     *
     * Expected with 2 instances:
     * jobTypeA: floor(100 / 2 * 0.7) = floor(50 * 0.7) = 35
     * jobTypeB: floor(100 / 2 * 0.3) = floor(50 * 0.3) = 15
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-concurrent');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for jobTypeA (concurrent-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-gamma']?.slots;
      // floor(100 / 2 * 0.7) = 35
      expect(slots).toBe(35);
    });

    it('should calculate correct slots for jobTypeB (concurrent-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-gamma']?.slots;
      // floor(100 / 2 * 0.3) = 15
      expect(slots).toBe(15);
    });
  });

  describe('Mixed Limits - Limiting Factor (slotCalc-tpm-rpm)', () => {
    /**
     * Config:
     * model-delta: TPM = 100,000, RPM = 50
     * jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1, ratio = 0.5
     *
     * Expected with 2 instances:
     * TPM-based: floor((100K/10K) / 2 * 0.5) = floor(5 * 0.5) = 2
     * RPM-based: floor((50/1) / 2 * 0.5) = floor(25 * 0.5) = 12
     * Actual: min(2, 12) = 2 (TPM is limiting)
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpm-rpm');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should use the limiting factor (TPM in this case)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-delta']?.slots;
      // min(TPM slots, RPM slots) = min(2, 12) = 2
      expect(slots).toBe(2);
    });
  });

  describe('Multiple Models with Different Limit Types (slotCalc-multi-model)', () => {
    /**
     * Config:
     * model-tpm: TPM = 100,000
     * model-concurrent: maxConcurrentRequests = 50
     * jobTypeA: estimatedTokens = 10,000, ratio = 0.5
     *
     * Expected with 2 instances:
     * model-tpm, jobTypeA: floor((100K/10K) / 2 * 0.5) = 2
     * model-concurrent, jobTypeA: floor(50 / 2 * 0.5) = 12
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-multi-model');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should calculate correct slots for TPM model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-tpm']?.slots;
      expect(slots).toBe(2);
    });

    it('should calculate correct slots for concurrent model', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-concurrent']?.slots;
      expect(slots).toBe(12);
    });

    it('should have different slot counts for different models', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const tpmSlots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-tpm']?.slots;
      const concurrentSlots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-concurrent']?.slots;

      expect(tpmSlots).not.toBe(concurrentSlots);
      expect(tpmSlots).toBeLessThan(concurrentSlots ?? 0);
    });
  });

  describe('Various Ratio Combinations (slotCalc-ratios)', () => {
    /**
     * Config:
     * model-alpha: TPM = 100,000
     * jobTypeA: ratio = 0.5
     * jobTypeB: ratio = 0.3
     * jobTypeC: ratio = 0.2
     *
     * Expected with 2 instances:
     * jobTypeA: floor((100K/10K) / 2 * 0.5) = 2
     * jobTypeB: floor((100K/10K) / 2 * 0.3) = 1
     * jobTypeC: floor((100K/10K) / 2 * 0.2) = 1
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-ratios');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should calculate correct slots for highest ratio (0.5)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots;
      expect(slots).toBe(2);
    });

    it('should calculate correct slots for medium ratio (0.3)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-alpha']?.slots;
      expect(slots).toBe(1);
    });

    it('should calculate correct slots for lowest ratio (0.2)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeC?.['model-alpha']?.slots;
      expect(slots).toBe(1);
    });

    it('should respect ratio proportions (A > B >= C)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slotsA = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots ?? 0;
      const slotsB = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-alpha']?.slots ?? 0;
      const slotsC = response.allocation?.slotsByJobTypeAndModel?.jobTypeC?.['model-alpha']?.slots ?? 0;

      expect(slotsA).toBeGreaterThanOrEqual(slotsB);
      expect(slotsB).toBeGreaterThanOrEqual(slotsC);
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

    it('should have allocation data structure', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);

      expect(response.allocation).not.toBeNull();
      expect(response.allocation?.slotsByJobTypeAndModel).toBeDefined();
      expect(typeof response.allocation?.slots).toBe('number');
      expect(typeof response.allocation?.instanceCount).toBe('number');
    });
  });

  describe('TPD-Only Model (slotCalc-tpd)', () => {
    /**
     * Config:
     * model-tpd: TPD = 1,000,000 (tokens per day)
     * jobTypeA: estimatedTokens = 10,000, ratio = 0.6
     * jobTypeB: estimatedTokens = 5,000, ratio = 0.4
     *
     * Expected with 2 instances:
     * jobTypeA: floor((1M/10K) / 2 * 0.6) = floor(50 * 0.6) = 30
     * jobTypeB: floor((1M/5K) / 2 * 0.4) = floor(100 * 0.4) = 40
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-tpd');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for jobTypeA (TPD-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-tpd']?.slots;
      // floor((1M/10K) / 2 * 0.6) = 30
      expect(slots).toBe(30);
    });

    it('should calculate correct slots for jobTypeB (TPD-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-tpd']?.slots;
      // floor((1M/5K) / 2 * 0.4) = 40
      expect(slots).toBe(40);
    });
  });

  describe('RPD-Only Model (slotCalc-rpd)', () => {
    /**
     * Config:
     * model-rpd: RPD = 10,000 (requests per day)
     * jobTypeA: estimatedRequests = 1, ratio = 0.6
     * jobTypeB: estimatedRequests = 5, ratio = 0.4
     *
     * Expected with 2 instances:
     * jobTypeA: floor((10K/1) / 2 * 0.6) = floor(5000 * 0.6) = 3000
     * jobTypeB: floor((10K/5) / 2 * 0.4) = floor(1000 * 0.4) = 400
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-rpd');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for jobTypeA (RPD-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-rpd']?.slots;
      // floor((10K/1) / 2 * 0.6) = 3000
      expect(slots).toBe(3000);
    });

    it('should calculate correct slots for jobTypeB (RPD-based)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-rpd']?.slots;
      // floor((10K/5) / 2 * 0.4) = 400
      expect(slots).toBe(400);
    });
  });

  describe('Uneven Ratios (slotCalc-uneven-ratios)', () => {
    /**
     * Config:
     * model-alpha: TPM = 100,000
     * jobTypeA: ratio = 0.7
     * jobTypeB: ratio = 0.1
     * jobTypeC: ratio = 0.1
     * jobTypeD: ratio = 0.1
     *
     * Expected with 2 instances:
     * jobTypeA: floor((100K/10K) / 2 * 0.7) = floor(5 * 0.7) = 3
     * jobTypeB: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
     * jobTypeC: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
     * jobTypeD: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
     */
    beforeAll(async () => {
      await setupInstances('slotCalc-uneven-ratios');
    }, BEFORE_ALL_TIMEOUT_MS);

    it('should report 2 instances', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should calculate correct slots for dominant ratio (0.7)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slots = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots;
      // floor((100K/10K) / 2 * 0.7) = 3
      expect(slots).toBe(3);
    });

    it('should handle low ratios that result in 0 slots', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slotsB = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-alpha']?.slots;
      const slotsC = response.allocation?.slotsByJobTypeAndModel?.jobTypeC?.['model-alpha']?.slots;
      const slotsD = response.allocation?.slotsByJobTypeAndModel?.jobTypeD?.['model-alpha']?.slots;

      // floor(5 * 0.1) = 0 for all low-ratio types
      expect(slotsB).toBe(0);
      expect(slotsC).toBe(0);
      expect(slotsD).toBe(0);
    });

    it('should maintain ratio proportions (A >> B, C, D)', async () => {
      const response = await fetchAllocation(INSTANCE_A_URL);
      const slotsA = response.allocation?.slotsByJobTypeAndModel?.jobTypeA?.['model-alpha']?.slots ?? 0;
      const slotsB = response.allocation?.slotsByJobTypeAndModel?.jobTypeB?.['model-alpha']?.slots ?? 0;

      // Dominant type should have significantly more slots
      expect(slotsA).toBeGreaterThan(slotsB);
    });
  });

  describe('Instance Count Variations', () => {
    /**
     * Test slot calculations with different instance counts (1, 2, 3).
     * Uses programmatic boot/kill for precise control.
     *
     * Formula verification:
     * With instanceScaling config (100K TPM, 10K tokens, ratio 1.0):
     * - 1 instance: floor((100K/10K) / 1 * 1.0) = 10 slots
     * - 2 instances: floor((100K/10K) / 2 * 1.0) = 5 slots each
     * - 3 instances: floor((100K/10K) / 3 * 1.0) = 3 slots each
     */
    const PORT_A = 4011;
    const PORT_B = 4012;
    const PORT_C = 4013;
    const INSTANCE_SCALE_TIMEOUT = 120000;

    afterAll(async () => {
      await killAllInstances();
    }, 30000);

    it('should calculate 10 slots with 1 instance', async () => {
      await killAllInstances();
      await cleanRedis();
      await bootInstance(PORT_A, 'instanceScaling');
      await sleep(ALLOCATION_PROPAGATION_MS);

      const response = await fetchAllocationFromPort(PORT_A);
      expect(response.allocation?.instanceCount).toBe(1);
      expect(response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(10);

      await killAllInstances();
    }, INSTANCE_SCALE_TIMEOUT);

    it('should calculate 5 slots each with 2 instances', async () => {
      await killAllInstances();
      await cleanRedis();
      await bootInstance(PORT_A, 'instanceScaling');
      await sleep(ALLOCATION_PROPAGATION_MS);
      await bootInstance(PORT_B, 'instanceScaling');
      await waitForAllocationUpdate(PORT_A, (a) => a.instanceCount === 2);

      const responseA = await fetchAllocationFromPort(PORT_A);
      const responseB = await fetchAllocationFromPort(PORT_B);

      expect(responseA.allocation?.instanceCount).toBe(2);
      expect(responseA.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(5);
      expect(responseB.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(5);

      await killAllInstances();
    }, INSTANCE_SCALE_TIMEOUT);

    it('should calculate 3 slots each with 3 instances', async () => {
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
      expect(responseA.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(3);
      expect(responseB.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(3);
      expect(responseC.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(3);

      await killAllInstances();
    }, INSTANCE_SCALE_TIMEOUT);
  });
});
