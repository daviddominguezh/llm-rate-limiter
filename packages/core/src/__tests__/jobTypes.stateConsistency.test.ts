/**
 * State consistency tests for job types.
 * Verifies that state invariants are maintained in all scenarios.
 */
import { describe, expect, it } from '@jest/globals';

import {
  EPSILON,
  FIVE,
  HUNDRED,
  ONE,
  RATIO_02,
  RATIO_03,
  RATIO_04,
  RATIO_06,
  RATIO_HALF,
  TEN,
  TWENTY,
  TWO,
  ZERO,
  createTestManager,
  sleep,
  sumAllocatedSlots,
  sumRatios,
} from './jobTypes.helpers.js';

describe('Job Types State Consistency - Ratio Sum', () => {
  it('should maintain sum of ratios = 1 after normalization', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_03 },
        typeB: { ratio: RATIO_03 },
        typeC: { ratio: RATIO_04 },
      },
      HUNDRED
    );

    try {
      // Initial sum should be 1
      expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);

      // After adjustments
      for (let i = ZERO; i < TWENTY; i += ONE) {
        manager.adjustRatios();
        expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);
      }
    } finally {
      manager.stop();
    }
  });

  it('should maintain sum of ratios = 1 with non-standard initial values', () => {
    // Initial ratios don't sum to 1 - should be normalized
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_02 },
        typeB: { ratio: RATIO_02 },
        typeC: { ratio: RATIO_02 },
      },
      HUNDRED
    );

    try {
      // Even with non-1 sum initial values, should normalize to 1
      const sum = sumRatios(manager);
      expect(Math.abs(sum - ONE)).toBeLessThan(EPSILON);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types State Consistency - Slot Sum', () => {
  it('should maintain sum of allocatedSlots <= totalCapacity after every capacity change', () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN);

    try {
      // Initial check
      expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(TEN);

      // Change capacity multiple times
      const capacities = [FIVE, TWENTY, ONE, HUNDRED, TEN];
      for (const capacity of capacities) {
        manager.setTotalCapacity(capacity);
        expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(capacity);
      }
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types State Consistency - Non-Negative inFlight', () => {
  it('should never have negative inFlight after any release sequence', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Release without acquire
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBeGreaterThanOrEqual(ZERO);

      // Acquire once, release multiple times
      manager.acquire('typeA');
      manager.release('typeA');
      manager.release('typeA');
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBeGreaterThanOrEqual(ZERO);

      // Complex acquire/release pattern
      for (let i = ZERO; i < FIVE; i += ONE) {
        manager.acquire('typeA');
      }
      for (let i = ZERO; i < TEN; i += ONE) {
        // More releases than acquires
        manager.release('typeA');
        expect(manager.getState('typeA')?.inFlight).toBeGreaterThanOrEqual(ZERO);
      }
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types State Consistency - After Stop', () => {
  it('should be safe to use after stop() is called', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    // Acquire some slots
    manager.acquire('typeA');
    manager.acquire('typeA');

    // Stop the manager
    manager.stop();

    // These operations should not throw
    expect(() => {
      manager.getState('typeA');
    }).not.toThrow();
    expect(() => {
      manager.getAllStates();
    }).not.toThrow();
    expect(() => {
      manager.hasCapacity('typeA');
    }).not.toThrow();
    expect(() => {
      manager.getStats();
    }).not.toThrow();

    // State should still be accessible
    const state = manager.getState('typeA');
    expect(state).toBeDefined();
  });

  it('should handle operations gracefully after stop', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    manager.stop();

    // These should not crash - behavior may vary but should be safe
    expect(() => {
      manager.acquire('typeA');
    }).not.toThrow();
    expect(() => {
      manager.release('typeA');
    }).not.toThrow();
    expect(() => {
      manager.adjustRatios();
    }).not.toThrow();
    expect(() => {
      manager.setTotalCapacity(TWENTY);
    }).not.toThrow();
  });
});

describe('Job Types State Consistency - Multiple Stop Calls', () => {
  it('should handle multiple stop() calls idempotently', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    // First stop
    expect(() => {
      manager.stop();
    }).not.toThrow();

    // Second stop - should be idempotent
    expect(() => {
      manager.stop();
    }).not.toThrow();

    // Third stop
    expect(() => {
      manager.stop();
    }).not.toThrow();

    // Should still be able to query state
    expect(manager.getState('typeA')).toBeDefined();
  });
});

const runConcurrentOperation = async (
  manager: ReturnType<typeof createTestManager>,
  jobType: string
): Promise<void> => {
  if (manager.acquire(jobType)) {
    await sleep(ONE);
    manager.release(jobType);
  }
};

describe('Job Types State Consistency - Concurrent Operations', () => {
  it('should maintain consistency during rapid acquire/release cycles', async () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN);

    try {
      const operations: Array<Promise<void>> = [];

      // Rapid concurrent operations
      for (let i = ZERO; i < HUNDRED; i += ONE) {
        const jobType = i % TWO === ZERO ? 'typeA' : 'typeB';
        operations.push(runConcurrentOperation(manager, jobType));
      }

      await Promise.all(operations);

      // After all operations, state should be consistent
      const stateA = manager.getState('typeA');
      const stateB = manager.getState('typeB');

      // inFlight should be 0 since all jobs completed
      expect(stateA?.inFlight).toBe(ZERO);
      expect(stateB?.inFlight).toBe(ZERO);

      // Ratios should still sum to 1
      expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);

      // Slots should not exceed capacity
      expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(TEN);
    } finally {
      manager.stop();
    }
  });
});

const acquireMultipleBothTypes = (manager: ReturnType<typeof createTestManager>, count: number): void => {
  for (let i = ZERO; i < count; i += ONE) {
    manager.acquire('typeA');
    manager.acquire('typeB');
  }
};

const releaseMultipleBothTypes = (manager: ReturnType<typeof createTestManager>, count: number): void => {
  for (let i = ZERO; i < count; i += ONE) {
    manager.release('typeA');
    manager.release('typeB');
  }
};

describe('Job Types State Consistency - Ratio Preservation', () => {
  it('should preserve ratio relationships after operations', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_06 },
        typeB: { ratio: RATIO_04 },
      },
      HUNDRED
    );

    try {
      const initialRatioA = manager.getState('typeA')?.currentRatio ?? ZERO;
      const initialRatioB = manager.getState('typeB')?.currentRatio ?? ZERO;

      // Verify initial ratio relationship (A > B)
      expect(initialRatioA).toBeGreaterThan(initialRatioB);

      // Acquire and release operations
      acquireMultipleBothTypes(manager, TEN);
      releaseMultipleBothTypes(manager, TEN);

      // Without ratio adjustment, ratios should remain the same
      const finalRatioA = manager.getState('typeA')?.currentRatio ?? ZERO;
      const finalRatioB = manager.getState('typeB')?.currentRatio ?? ZERO;

      expect(finalRatioA).toBeCloseTo(initialRatioA, FIVE);
      expect(finalRatioB).toBeCloseTo(initialRatioB, FIVE);
    } finally {
      manager.stop();
    }
  });
});
