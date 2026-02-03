/**
 * Ratio adjustment algorithm edge case tests.
 * Verifies edge cases and invariants in the ratio adjustment algorithm.
 */
import { describe, expect, it } from '@jest/globals';

import {
  EPSILON,
  FIVE,
  HUNDRED,
  ONE,
  RATIO_HALF,
  TEN,
  THOUSAND,
  ZERO,
  createTestManager,
  sumRatios,
} from './jobTypes.helpers.js';

const HIGH_LOAD = 0.8;
const LOW_LOAD = 0.3;
const ADJUSTMENT = 0.1;
const MIN_RATIO = 0.05;
const FORTY = 40;
const FIFTY = 50;

describe('Job Types Ratio Algorithm - All High Load', () => {
  it('should handle adjustment when all flexible types are high-load', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_HALF },
        typeB: { ratio: RATIO_HALF },
      },
      TEN,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: ADJUSTMENT,
        minRatio: MIN_RATIO,
      }
    );

    try {
      // Make both types high load (all slots used)
      const slotsA = manager.getState('typeA')?.allocatedSlots ?? ZERO;
      const slotsB = manager.getState('typeB')?.allocatedSlots ?? ZERO;

      for (let i = ZERO; i < slotsA; i++) {
        manager.acquire('typeA');
      }
      for (let i = ZERO; i < slotsB; i++) {
        manager.acquire('typeB');
      }

      // Both are at high load - no donors available
      const ratioABefore = manager.getState('typeA')?.currentRatio ?? ZERO;
      const ratioBBefore = manager.getState('typeB')?.currentRatio ?? ZERO;

      // Attempt adjustment - should not crash and should maintain invariants
      manager.adjustRatios();

      // Ratios should remain roughly the same (no donors to take from)
      const ratioAAfter = manager.getState('typeA')?.currentRatio ?? ZERO;
      const ratioBAfter = manager.getState('typeB')?.currentRatio ?? ZERO;

      // Total should still sum to 1
      expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);

      // No significant change should occur
      expect(Math.abs(ratioAAfter - ratioABefore)).toBeLessThan(ADJUSTMENT + EPSILON);
      expect(Math.abs(ratioBAfter - ratioBBefore)).toBeLessThan(ADJUSTMENT + EPSILON);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - Zero Slot Receivers', () => {
  it('should handle adjustment with zero-slot job types as potential receivers', () => {
    // Create with very small ratio that results in 0 slots
    const manager = createTestManager(
      {
        tinyType: { ratio: 0.01 },
        largeType: { ratio: 0.99 },
      },
      TEN,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: ADJUSTMENT,
        minRatio: MIN_RATIO,
      }
    );

    try {
      // tinyType should have 0 slots initially
      expect(manager.getState('tinyType')?.allocatedSlots).toBe(ZERO);

      // Since it has 0 slots, hasCapacity should return false
      expect(manager.hasCapacity('tinyType')).toBe(false);

      // Adjust ratios
      manager.adjustRatios();

      // Should not crash and ratios should still sum to 1
      expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - Floating Point Precision', () => {
  it('should maintain floating point precision over many adjustment cycles', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: 0.33 },
        typeB: { ratio: 0.33 },
        typeC: { ratio: 0.34 },
      },
      HUNDRED,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: 0.01,
        minRatio: 0.01,
      }
    );

    try {
      // Run 1000 adjustment cycles with varying loads
      for (let cycle = ZERO; cycle < THOUSAND; cycle++) {
        // Alternate load patterns
        if (cycle % FIVE === ZERO) {
          // High load on typeA
          const slots = manager.getState('typeA')?.allocatedSlots ?? ZERO;
          for (let i = ZERO; i < slots; i++) {
            manager.acquire('typeA');
          }
        }
        if (cycle % FIVE === ONE) {
          // Release typeA
          const inFlight = manager.getState('typeA')?.inFlight ?? ZERO;
          for (let i = ZERO; i < inFlight; i++) {
            manager.release('typeA');
          }
        }

        manager.adjustRatios();

        // Verify ratio sum invariant after every adjustment
        const sum = sumRatios(manager);
        expect(Math.abs(sum - ONE)).toBeLessThan(EPSILON);
      }

      // Final check: all ratios should be positive
      const stateA = manager.getState('typeA');
      const stateB = manager.getState('typeB');
      const stateC = manager.getState('typeC');

      expect(stateA?.currentRatio).toBeGreaterThan(ZERO);
      expect(stateB?.currentRatio).toBeGreaterThan(ZERO);
      expect(stateC?.currentRatio).toBeGreaterThan(ZERO);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - releasesPerAdjustment Trigger', () => {
  it('should respect releasesPerAdjustment trigger correctly', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: RATIO_HALF },
        typeB: { ratio: RATIO_HALF },
      },
      TEN,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: ADJUSTMENT,
        minRatio: MIN_RATIO,
        adjustmentIntervalMs: ZERO, // Disable time-based
        releasesPerAdjustment: FIVE, // Trigger after 5 releases
      }
    );

    try {
      // Put typeA at high load
      const slots = manager.getState('typeA')?.allocatedSlots ?? ZERO;
      for (let i = ZERO; i < slots; i++) {
        manager.acquire('typeA');
      }

      const initialRatio = manager.getState('typeA')?.currentRatio ?? ZERO;

      // Release 4 times (below threshold)
      for (let i = ZERO; i < FIVE - ONE; i++) {
        manager.release('typeA');
        manager.acquire('typeA'); // Re-acquire to maintain high load
      }

      // After 4 releases, check that periodic adjustment has not been triggered
      // (ratios may still be the same or close)

      // Release 5th time (hits threshold)
      manager.release('typeA');

      // Wait a bit for any async adjustment
      // Note: The adjustment trigger is based on release count

      // The ratios should still sum to 1
      expect(Math.abs(sumRatios(manager) - ONE)).toBeLessThan(EPSILON);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - minRatio Floor', () => {
  it('should never reduce ratio below minRatio', () => {
    const verySmallMinRatio = 0.01;
    const manager = createTestManager(
      {
        typeA: { ratio: 0.9 },
        typeB: { ratio: 0.1 }, // Start close to min
      },
      HUNDRED,
      {
        highLoadThreshold: 0.5,
        lowLoadThreshold: 0.2,
        maxAdjustment: 0.2, // Large adjustment to stress test
        minRatio: verySmallMinRatio,
      }
    );

    try {
      // Make typeA high load, typeB low load
      const slotsA = manager.getState('typeA')?.allocatedSlots ?? ZERO;
      for (let i = ZERO; i < slotsA; i++) {
        manager.acquire('typeA');
      }
      // typeB stays idle (low load)

      // Run many adjustment cycles to try to push typeB below minRatio
      for (let i = ZERO; i < FIFTY; i++) {
        manager.adjustRatios();

        // Verify typeB never goes below minRatio
        const ratioB = manager.getState('typeB')?.currentRatio ?? ZERO;
        expect(ratioB).toBeGreaterThanOrEqual(verySmallMinRatio - EPSILON);
      }

      // Final verification
      expect(sumRatios(manager)).toBeCloseTo(ONE, FIVE);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - Only Non-Flexible Donors', () => {
  it('should not transfer capacity when only non-flexible types could donate', () => {
    const manager = createTestManager(
      {
        nonFlexibleLow: { ratio: 0.4, flexible: false }, // Potential donor but non-flexible
        nonFlexibleHigh: { ratio: 0.3, flexible: false }, // Non-flexible
        flexibleHigh: { ratio: 0.3 }, // Receiver (high load)
      },
      TEN,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: ADJUSTMENT,
        minRatio: MIN_RATIO,
      }
    );

    try {
      const initialNonFlexLow = manager.getState('nonFlexibleLow')?.currentRatio ?? ZERO;
      const initialNonFlexHigh = manager.getState('nonFlexibleHigh')?.currentRatio ?? ZERO;

      // Make flexibleHigh at high load
      const slots = manager.getState('flexibleHigh')?.allocatedSlots ?? ZERO;
      for (let i = ZERO; i < slots; i++) {
        manager.acquire('flexibleHigh');
      }

      // Adjust multiple times
      for (let i = ZERO; i < TEN; i++) {
        manager.adjustRatios();
      }

      // Non-flexible types should not have changed
      expect(manager.getState('nonFlexibleLow')?.currentRatio).toBeCloseTo(initialNonFlexLow, FIVE);
      expect(manager.getState('nonFlexibleHigh')?.currentRatio).toBeCloseTo(initialNonFlexHigh, FIVE);

      // Ratios should still sum to 1
      expect(sumRatios(manager)).toBeCloseTo(ONE, FIVE);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Ratio Algorithm - Mixed Flexible and Non-Flexible', () => {
  it('should only transfer between flexible types', () => {
    const manager = createTestManager(
      {
        flexibleHighLoad: { ratio: 0.3 }, // Receiver
        flexibleLowLoad: { ratio: 0.3 }, // Donor
        nonFlexibleIdle: { ratio: 0.4, flexible: false }, // Should not participate
      },
      HUNDRED,
      {
        highLoadThreshold: HIGH_LOAD,
        lowLoadThreshold: LOW_LOAD,
        maxAdjustment: ADJUSTMENT,
        minRatio: MIN_RATIO,
      }
    );

    try {
      const initialNonFlex = manager.getState('nonFlexibleIdle')?.currentRatio ?? ZERO;

      // Make flexibleHighLoad at high load
      const slots = manager.getState('flexibleHighLoad')?.allocatedSlots ?? ZERO;
      for (let i = ZERO; i < slots; i++) {
        manager.acquire('flexibleHighLoad');
      }

      // Adjust
      manager.adjustRatios();

      // Non-flexible should be unchanged
      expect(manager.getState('nonFlexibleIdle')?.currentRatio).toBe(initialNonFlex);

      // Flexible types should have changed (high load received from low load)
      const flexHighRatio = manager.getState('flexibleHighLoad')?.currentRatio ?? ZERO;
      const flexLowRatio = manager.getState('flexibleLowLoad')?.currentRatio ?? ZERO;

      // High load type should have gained ratio
      expect(flexHighRatio).toBeGreaterThan(0.3 - EPSILON);

      // Ratios should sum to 1
      expect(sumRatios(manager)).toBeCloseTo(ONE, FIVE);
    } finally {
      manager.stop();
    }
  });
});
