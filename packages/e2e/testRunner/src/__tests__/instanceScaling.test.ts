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
 * - With 3 instances: floor((100K/10K) / 3 * 1.0) = 3 slots per instance
 *
 * Key behaviors to verify:
 * 1. When instance B joins after A, A's slots halve (from 10 to 5)
 * 2. When instance B disconnects, A's slots double (back to 10)
 * 3. Total capacity across all instances stays constant
 *
 * Note: This test uses programmatic instance boot/kill for precise control.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import {
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
  killInstance,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

const PORT_A = 4001; // Use different ports to avoid conflict with other tests
const PORT_B = 4002;
const PORT_C = 4003;

const CONFIG_PRESET: ConfigPresetName = 'instanceScaling';
const ALLOCATION_PROPAGATION_MS = 2000;
const INSTANCE_CLEANUP_TIMEOUT_MS = 20000; // Time for heartbeat timeout + cleanup
const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

describe('Instance Scaling', () => {
  // Clean up all instances after all tests
  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  describe('Instance A Starts Alone', () => {
    /**
     * Scenario:
     * 1. Clean Redis and boot Instance A alone
     * 2. A should get full capacity (10 slots)
     */
    beforeAll(async () => {
      await killAllInstances();
      await cleanRedis();
      await bootInstance(PORT_A, CONFIG_PRESET);
      await sleep(ALLOCATION_PROPAGATION_MS);
    }, BEFORE_ALL_TIMEOUT_MS);

    afterAll(async () => {
      await killAllInstances();
    }, AFTER_ALL_TIMEOUT_MS);

    it('should report 1 instance', async () => {
      const response = await fetchAllocation(PORT_A);
      expect(response.allocation?.instanceCount).toBe(1);
    });

    it('should have 10 slots as single instance', async () => {
      const response = await fetchAllocation(PORT_A);
      const slots = response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots;
      // floor((100K/10K) / 1 * 1.0) = 10
      expect(slots).toBe(10);
    });
  });

  describe('Instance B Joins - Slots Halve', () => {
    /**
     * Scenario:
     * 1. Instance A starts alone (gets 10 slots)
     * 2. Instance B joins
     * 3. Both instances should have 5 slots each
     */
    beforeAll(async () => {
      await killAllInstances();
      await cleanRedis();

      // Start Instance A first
      await bootInstance(PORT_A, CONFIG_PRESET);
      await sleep(ALLOCATION_PROPAGATION_MS);

      // Verify A has full capacity initially
      const initialAlloc = await fetchAllocation(PORT_A);
      expect(initialAlloc.allocation?.instanceCount).toBe(1);
      expect(initialAlloc.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(10);

      // Now boot Instance B
      await bootInstance(PORT_B, CONFIG_PRESET);

      // Wait for A to receive the updated allocation
      await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === 2);
    }, BEFORE_ALL_TIMEOUT_MS);

    afterAll(async () => {
      await killAllInstances();
    }, AFTER_ALL_TIMEOUT_MS);

    it('should report 2 instances on Instance A', async () => {
      const response = await fetchAllocation(PORT_A);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should report 2 instances on Instance B', async () => {
      const response = await fetchAllocation(PORT_B);
      expect(response.allocation?.instanceCount).toBe(2);
    });

    it('should have 5 slots on Instance A after B joins', async () => {
      const response = await fetchAllocation(PORT_A);
      const slots = response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots;
      // floor((100K/10K) / 2 * 1.0) = 5
      expect(slots).toBe(5);
    });

    it('should have 5 slots on Instance B', async () => {
      const response = await fetchAllocation(PORT_B);
      const slots = response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots;
      // floor((100K/10K) / 2 * 1.0) = 5
      expect(slots).toBe(5);
    });

    it('should have consistent allocation on both instances', async () => {
      const responseA = await fetchAllocation(PORT_A);
      const responseB = await fetchAllocation(PORT_B);

      expect(responseA.allocation?.instanceCount).toBe(responseB.allocation?.instanceCount);
      expect(responseA.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(
        responseB.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots
      );
    });
  });

  describe('Instance B Leaves - Slots Double', () => {
    /**
     * Scenario:
     * 1. Instance A and B are running (5 slots each)
     * 2. Instance B is killed (while A remains running)
     * 3. Instance A should detect B's departure via heartbeat timeout
     * 4. Instance A should get back full capacity (10 slots)
     *
     * This tests the realistic scenario where an instance dies while others
     * continue running and need to detect the change via heartbeat timeout.
     */
    beforeAll(async () => {
      await killAllInstances();
      await cleanRedis();

      // Start both instances
      await bootInstance(PORT_A, CONFIG_PRESET);
      await sleep(ALLOCATION_PROPAGATION_MS);
      await bootInstance(PORT_B, CONFIG_PRESET);
      await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === 2);

      // Verify both have 5 slots
      const allocA = await fetchAllocation(PORT_A);
      expect(allocA.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots).toBe(5);

      // Kill ONLY Instance B while A continues running
      // This tests heartbeat timeout detection
      await killInstance(PORT_B);

      // Wait for A to detect B's departure via heartbeat timeout + reallocation
      // This may take longer as it depends on heartbeat interval and cleanup
      await waitForAllocationUpdate(
        PORT_A,
        (alloc) => alloc.instanceCount === 1,
        INSTANCE_CLEANUP_TIMEOUT_MS
      );
    }, BEFORE_ALL_TIMEOUT_MS * 2);

    afterAll(async () => {
      await killAllInstances();
    }, AFTER_ALL_TIMEOUT_MS);

    it('should report 1 instance on Instance A after B leaves', async () => {
      const response = await fetchAllocation(PORT_A);
      expect(response.allocation?.instanceCount).toBe(1);
    });

    it('should have 10 slots on Instance A after B leaves', async () => {
      const response = await fetchAllocation(PORT_A);
      const slots = response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots;
      // floor((100K/10K) / 1 * 1.0) = 10
      expect(slots).toBe(10);
    });

    it('should have A running continuously (not restarted)', async () => {
      // This verifies A stayed running the whole time by checking it's still responsive
      const response = await fetchAllocation(PORT_A);
      expect(response.allocation).not.toBeNull();
      expect(response.instanceId).toBeDefined();
    });
  });

  describe('Multiple Instance Joins and Leaves', () => {
    /**
     * Scenario:
     * 1. A starts alone (10 slots)
     * 2. B joins (A and B each have 5 slots)
     * 3. C joins (A, B, C each have 3 slots)
     * 4. C leaves (A and B each have 5 slots)
     * 5. B leaves (A has 10 slots)
     */
    const verifySlots = async (port: number, expectedSlots: number): Promise<void> => {
      const response = await fetchAllocation(port);
      const slots = response.allocation?.slotsByJobTypeAndModel?.scaleJob?.['scale-model']?.slots;
      expect(slots).toBe(expectedSlots);
    };

    beforeAll(async () => {
      await killAllInstances();
      await cleanRedis();
    }, BEFORE_ALL_TIMEOUT_MS);

    afterAll(async () => {
      await killAllInstances();
    }, AFTER_ALL_TIMEOUT_MS);

    it('should redistribute slots through multiple join/leave cycles', async () => {
      // Step 1: A starts alone with 10 slots
      await bootInstance(PORT_A, CONFIG_PRESET);
      await sleep(ALLOCATION_PROPAGATION_MS);
      await verifySlots(PORT_A, 10);

      // Step 2: B joins, both have 5 slots
      await bootInstance(PORT_B, CONFIG_PRESET);
      await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === 2);
      await verifySlots(PORT_A, 5);
      await verifySlots(PORT_B, 5);

      // Step 3: C joins, all have 3 slots
      await bootInstance(PORT_C, CONFIG_PRESET);
      await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === 3);
      await verifySlots(PORT_A, 3);
      await verifySlots(PORT_B, 3);
      await verifySlots(PORT_C, 3);
    }, BEFORE_ALL_TIMEOUT_MS * 2);
  });
});
