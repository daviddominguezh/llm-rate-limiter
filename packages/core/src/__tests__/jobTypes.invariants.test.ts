/**
 * Core invariant tests for job types.
 * Verifies that critical invariants are maintained during concurrent execution.
 */
import { describe, expect, it } from '@jest/globals';

import {
  EPSILON,
  FIVE,
  HUNDRED,
  ONE,
  RATIO_HALF,
  SHORT_DELAY_MS,
  TEN,
  TWENTY,
  TWO,
  ZERO,
  createInvariantChecker,
  createTestManager,
  sumAllocatedSlots,
  sumRatios,
} from './jobTypes.helpers.js';

describe('Job Types - Invariant: inFlight <= allocatedSlots', () => {
  it('should maintain inFlight <= allocatedSlots during concurrent execution', async () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN);
    const checker = createInvariantChecker(manager);

    try {
      // Simulate concurrent acquire/release cycles with manual invariant checks
      const operations: Array<Promise<void>> = [];

      for (let i = ZERO; i < TWENTY; i++) {
        const jobType = i % TWO === ZERO ? 'typeA' : 'typeB';
        operations.push(
          (async () => {
            // Wait for capacity
            while (!manager.hasCapacity(jobType)) {
              checker.check(); // Check invariant while waiting
              await new Promise((r) => setTimeout(r, ONE));
            }
            if (manager.acquire(jobType)) {
              checker.check(); // Check invariant after acquire
              await new Promise((r) => setTimeout(r, SHORT_DELAY_MS));
              manager.release(jobType);
              checker.check(); // Check invariant after release
            }
          })()
        );
      }

      await Promise.all(operations);
    } finally {
      manager.stop();
    }

    checker.assertNoViolations();
    expect(checker.checkCount).toBeGreaterThan(ZERO);
  });
});

describe('Job Types - Invariant: Internal State Matches External', () => {
  it('should verify manager internal inFlight matches actual execution count', async () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);
    let externalCount = ZERO;

    try {
      // Acquire 5 slots
      for (let i = ZERO; i < FIVE; i++) {
        const acquired = manager.acquire('typeA');
        if (acquired) externalCount += ONE;
      }

      const internalCount = manager.getState('typeA')?.inFlight ?? ZERO;
      expect(internalCount).toBe(externalCount);
      expect(internalCount).toBe(FIVE);

      // Release 2 slots
      manager.release('typeA');
      manager.release('typeA');
      externalCount -= TWO;

      const afterRelease = manager.getState('typeA')?.inFlight ?? ZERO;
      expect(afterRelease).toBe(externalCount);
      expect(afterRelease).toBe(FIVE - TWO);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Invariant: Atomic Acquire', () => {
  it('should ensure acquire() is atomic under concurrent access', async () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, ONE);
    const results: boolean[] = [];

    try {
      // Race 10 concurrent acquires on single slot
      const acquirePromises = Array.from({ length: TEN }, async () => {
        // Small random delay to create race condition
        await new Promise((r) => setTimeout(r, Math.random() * FIVE));
        return manager.acquire('typeA');
      });

      const acquired = await Promise.all(acquirePromises);
      results.push(...acquired);

      // Exactly 1 should succeed
      const successCount = results.filter((r) => r).length;
      expect(successCount).toBe(ONE);

      // inFlight should be exactly 1
      expect(manager.getState('typeA')?.inFlight).toBe(ONE);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Invariant: Ratio Sum', () => {
  it('should maintain sum of ratios = 1 after every adjustment cycle', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: 0.4 },
        typeB: { ratio: 0.3 },
        typeC: { ratio: 0.3 },
      },
      HUNDRED,
      { adjustmentIntervalMs: ZERO, releasesPerAdjustment: ZERO }
    );

    try {
      // Run 50 adjustment cycles
      for (let cycle = ZERO; cycle < TWENTY * TWO + TEN; cycle++) {
        // Simulate varying load
        if (cycle % TWO === ZERO) {
          manager.acquire('typeA');
        }
        if (cycle % FIVE === ZERO) {
          manager.release('typeA');
        }

        manager.adjustRatios();

        const sum = sumRatios(manager);
        expect(Math.abs(sum - ONE)).toBeLessThan(EPSILON);
      }
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Invariant: Slots Sum', () => {
  it('should ensure allocatedSlots sum <= totalCapacity with single type', () => {
    const capacities = [ONE, FIVE, TEN, HUNDRED];
    for (const capacity of capacities) {
      const manager = createTestManager({ typeA: { ratio: ONE } }, capacity);
      try {
        expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(capacity);
      } finally {
        manager.stop();
      }
    }
  });

  it('should ensure allocatedSlots sum <= totalCapacity with two types', () => {
    const capacities = [ONE, FIVE, TEN, HUNDRED];
    for (const capacity of capacities) {
      const manager = createTestManager(
        { typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } },
        capacity
      );
      try {
        expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(capacity);
      } finally {
        manager.stop();
      }
    }
  });

  it('should ensure allocatedSlots sum <= totalCapacity with three types', () => {
    const capacities = [ONE, FIVE, TEN, HUNDRED];
    for (const capacity of capacities) {
      const manager = createTestManager(
        { typeA: { ratio: 0.33 }, typeB: { ratio: 0.33 }, typeC: { ratio: 0.34 } },
        capacity
      );
      try {
        expect(sumAllocatedSlots(manager)).toBeLessThanOrEqual(capacity);
      } finally {
        manager.stop();
      }
    }
  });
});

describe('Job Types - Invariant: Non-Negative inFlight', () => {
  it('should never allow inFlight to go negative', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Release without acquire (should be safe)
      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Multiple releases without acquire
      for (let i = ZERO; i < FIVE; i++) {
        manager.release('typeA');
      }
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      // Acquire once, release twice
      manager.acquire('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ONE);

      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);

      manager.release('typeA');
      expect(manager.getState('typeA')?.inFlight).toBe(ZERO);
    } finally {
      manager.stop();
    }
  });
});
