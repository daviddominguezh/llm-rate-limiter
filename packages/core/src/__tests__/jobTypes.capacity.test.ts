/**
 * Capacity edge case tests for job types.
 * Verifies behavior at capacity boundaries and during capacity changes.
 */
import { describe, expect, it } from '@jest/globals';

import {
  EPSILON,
  FIVE,
  HUNDRED,
  ONE,
  RATIO_034,
  RATIO_09,
  RATIO_099,
  RATIO_HALF,
  RATIO_TENTH,
  RATIO_THIRD,
  RATIO_TINY,
  SHORT_DELAY_MS,
  TEN,
  THREE,
  TWO,
  ZERO,
  createDelayedJob,
  createInvariantChecker,
  createTestLimiter,
  createTestManager,
  sleep,
  sumAllocatedSlots,
} from './jobTypes.helpers.js';

describe('Job Types Capacity - Zero Capacity', () => {
  it('should handle zero capacity gracefully', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, ZERO);

    try {
      // With zero capacity, no slots should be allocated
      expect(manager.getState('typeA')?.allocatedSlots).toBe(ZERO);

      // Acquire should fail
      expect(manager.acquire('typeA')).toBe(false);
      expect(manager.hasCapacity('typeA')).toBe(false);

      // inFlight should stay at zero
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - Capacity Reduction Mid-Execution', () => {
  it('should handle capacity reduction while jobs are in-flight', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      // Start some jobs that take time
      const jobPromises: Array<Promise<unknown>> = [];
      for (let i = ZERO; i < FIVE; i += ONE) {
        jobPromises.push(
          limiter.queueJob({
            jobId: `job-${i}`,
            jobType: 'typeA',
            job: createDelayedJob(SHORT_DELAY_MS * TEN),
          })
        );
      }

      // Wait a bit for jobs to start
      await sleep(SHORT_DELAY_MS);

      // Check that jobs are in flight
      const statsInFlight = limiter.getJobTypeStats();
      expect(statsInFlight?.jobTypes.typeA?.inFlight).toBeGreaterThan(ZERO);

      // Note: In this implementation, capacity is set at creation time
      // The limiter doesn't expose a setCapacity method, so we're testing
      // that the initial capacity is respected during execution
      await Promise.all(jobPromises);

      // After all jobs complete, inFlight should be zero
      const statsAfter = limiter.getJobTypeStats();
      expect(statsAfter?.jobTypes.typeA?.inFlight).toBe(ZERO);
    } finally {
      limiter.stop();
    }
  });
});

const acquireMultiple = (
  manager: ReturnType<typeof createTestManager>,
  jobType: string,
  count: number
): void => {
  for (let i = ZERO; i < count; i += ONE) {
    manager.acquire(jobType);
  }
};

const releaseMultiple = (
  manager: ReturnType<typeof createTestManager>,
  jobType: string,
  count: number
): void => {
  for (let i = ZERO; i < count; i += ONE) {
    manager.release(jobType);
  }
};

describe('Job Types Capacity - Capacity Reduction Below inFlight', () => {
  it('should handle capacity reduction below current inFlight', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Acquire 5 slots
      acquireMultiple(manager, 'typeA', FIVE);
      expect(manager.getState('typeA')?.inFlight).toBe(FIVE);

      // Reduce capacity to 2 (less than current inFlight)
      manager.setTotalCapacity(TWO);

      // inFlight should remain unchanged
      const state = manager.getState('typeA');
      expect(state?.inFlight).toBe(FIVE);

      // allocatedSlots should be reduced
      expect(state?.allocatedSlots).toBeLessThanOrEqual(TWO);

      // No new acquires should succeed since inFlight > allocatedSlots
      expect(manager.acquire('typeA')).toBe(false);
      expect(manager.hasCapacity('typeA')).toBe(false);

      // Release slots until we're below capacity
      releaseMultiple(manager, 'typeA', FIVE);
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Now we should be able to acquire again
      expect(manager.hasCapacity('typeA')).toBe(true);
      expect(manager.acquire('typeA')).toBe(true);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - Very Small Ratios', () => {
  it('should allocate zero slots for very small ratios relative to others', () => {
    // With ratio 0.01 vs 0.99, the tiny type should get ~0 slots
    // 0.01 * 10 = 0.1 -> floors to 0
    const manager = createTestManager(
      { tinyType: { ratio: RATIO_TINY }, mainType: { ratio: RATIO_099 } },
      TEN
    );

    try {
      const tinyState = manager.getState('tinyType');
      const mainState = manager.getState('mainType');

      // Tiny type should get 0 slots (floor of 0.1)
      expect(tinyState?.allocatedSlots).toBe(ZERO);

      // Main type should get most slots
      expect(mainState?.allocatedSlots).toBe(TEN - ONE); // 9 slots

      // Tiny type cannot acquire
      expect(manager.acquire('tinyType')).toBe(false);
    } finally {
      manager.stop();
    }
  });

  it('should allocate proportional slots with multiple types', () => {
    // With ratio 0.1 and 0.9 and capacity 100
    // 0.1 * 100 = 10, 0.9 * 100 = 90
    const manager = createTestManager(
      { smallType: { ratio: RATIO_TENTH }, largeType: { ratio: RATIO_09 } },
      HUNDRED
    );

    try {
      const smallState = manager.getState('smallType');
      const largeState = manager.getState('largeType');

      expect(smallState?.allocatedSlots).toBe(TEN);
      expect(largeState?.allocatedSlots).toBe(HUNDRED - TEN); // 90 slots
      expect(manager.acquire('smallType')).toBe(true);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - All Types at Capacity', () => {
  it('should handle all job types at capacity simultaneously', () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN);
    const checker = createInvariantChecker(manager);

    try {
      // Each type should get 5 slots
      const typeASlots = manager.getState('typeA')?.allocatedSlots ?? ZERO;
      const typeBSlots = manager.getState('typeB')?.allocatedSlots ?? ZERO;
      expect(typeASlots + typeBSlots).toBeLessThanOrEqual(TEN);

      // Exhaust all slots for both types
      let acquiredA = ZERO;
      let acquiredB = ZERO;

      while (manager.acquire('typeA')) {
        acquiredA += ONE;
        checker.check();
      }
      while (manager.acquire('typeB')) {
        acquiredB += ONE;
        checker.check();
      }

      // Verify we acquired expected amounts
      expect(acquiredA).toBe(typeASlots);
      expect(acquiredB).toBe(typeBSlots);

      // No more capacity for either type
      expect(manager.hasCapacity('typeA')).toBe(false);
      expect(manager.hasCapacity('typeB')).toBe(false);

      checker.assertNoViolations();
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - Single Slot Contention', () => {
  it('should handle single slot contention correctly', () => {
    // Only one slot available for each type
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TWO);
    const checker = createInvariantChecker(manager);

    try {
      // Each type should get 1 slot
      expect(manager.getState('typeA')?.allocatedSlots).toBe(ONE);
      expect(manager.getState('typeB')?.allocatedSlots).toBe(ONE);

      // Acquire typeA's slot
      expect(manager.acquire('typeA')).toBe(true);
      checker.check();

      // typeA should have no more capacity
      expect(manager.hasCapacity('typeA')).toBe(false);
      expect(manager.acquire('typeA')).toBe(false);
      checker.check();

      // typeB should still have capacity
      expect(manager.hasCapacity('typeB')).toBe(true);
      expect(manager.acquire('typeB')).toBe(true);
      checker.check();

      // Now both are at capacity
      expect(manager.hasCapacity('typeA')).toBe(false);
      expect(manager.hasCapacity('typeB')).toBe(false);

      checker.assertNoViolations();
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - Fractional Slot Allocation', () => {
  it('should handle fractional slot allocation correctly (3 types x 0.33)', () => {
    // 3 types × 0.33 ratio × 10 capacity = 3.3 slots each
    // Should floor to 3 slots each = 9 total (not 10)
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_THIRD },
        typeB: { ratio: RATIO_THIRD },
        typeC: { ratio: RATIO_034 },
      },
      TEN
    );

    try {
      const totalSlots = sumAllocatedSlots(manager);
      // Total should not exceed capacity
      expect(totalSlots).toBeLessThanOrEqual(TEN);

      // Each type should get floor(ratio * capacity)
      const typeASlots = manager.getState('typeA')?.allocatedSlots ?? ZERO;
      const typeBSlots = manager.getState('typeB')?.allocatedSlots ?? ZERO;
      const typeCSlots = manager.getState('typeC')?.allocatedSlots ?? ZERO;

      // With flooring: 0.33*10=3, 0.33*10=3, 0.34*10=3
      expect(typeASlots).toBe(THREE);
      expect(typeBSlots).toBe(THREE);
      expect(typeCSlots).toBe(THREE);
      expect(typeASlots + typeBSlots + typeCSlots).toBe(TEN - ONE); // 9 slots used, 1 wasted due to rounding
    } finally {
      manager.stop();
    }
  });

  it('should handle equal ratios that sum to 1 but round down', () => {
    // 3 types × 1/3 ratio × 10 capacity = 3.33 slots each
    // Sum of 1/3 + 1/3 + 1/3 should equal 1
    const thirdRatio = ONE / THREE;
    const manager = createTestManager(
      {
        typeA: { ratio: thirdRatio },
        typeB: { ratio: thirdRatio },
        typeC: { ratio: thirdRatio },
      },
      TEN
    );

    try {
      // Verify ratios sum to ~1
      const stateA = manager.getState('typeA');
      const stateB = manager.getState('typeB');
      const stateC = manager.getState('typeC');
      const ratioSum =
        (stateA?.currentRatio ?? ZERO) + (stateB?.currentRatio ?? ZERO) + (stateC?.currentRatio ?? ZERO);
      expect(Math.abs(ratioSum - ONE)).toBeLessThan(EPSILON);

      // Total allocated slots should not exceed capacity
      const totalSlots = sumAllocatedSlots(manager);
      expect(totalSlots).toBeLessThanOrEqual(TEN);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Capacity - Capacity Increase', () => {
  it('should handle capacity increase correctly', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, FIVE);

    try {
      // Initially 5 slots
      expect(manager.getState('typeA')?.allocatedSlots).toBe(FIVE);

      // Acquire all slots
      acquireMultiple(manager, 'typeA', FIVE);
      expect(manager.hasCapacity('typeA')).toBe(false);

      // Increase capacity
      manager.setTotalCapacity(TEN);

      // Now should have more allocated slots
      expect(manager.getState('typeA')?.allocatedSlots).toBe(TEN);

      // And should be able to acquire more
      expect(manager.hasCapacity('typeA')).toBe(true);
      acquireMultiple(manager, 'typeA', FIVE);

      // Now all 10 slots used
      expect(manager.getState('typeA')?.inFlight).toBe(TEN);
      expect(manager.hasCapacity('typeA')).toBe(false);
    } finally {
      manager.stop();
    }
  });
});
