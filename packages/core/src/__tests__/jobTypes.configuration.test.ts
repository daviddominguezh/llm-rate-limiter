/**
 * Configuration validation tests for job types.
 * Verifies edge cases in configuration handling.
 */
import { describe, expect, it } from '@jest/globals';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import {
  DEFAULT_PRICING,
  FIVE,
  HIGH_RPM,
  HUNDRED,
  ONE,
  RATIO_HALF,
  TEN,
  ZERO,
  createSimpleTestJob,
  createTestLimiter,
  createTestManager,
} from './jobTypes.helpers.js';

const MILLION = 1000000;

describe('Job Types Configuration - Ratio Boundaries', () => {
  it('should reject ratio exactly 0', () => {
    // Ratio of 0 should be rejected by validation
    expect(() =>
      createTestManager(
        {
          zeroRatio: { ratio: ZERO },
          normalRatio: { ratio: ONE },
        },
        TEN
      )
    ).toThrow('ratio.initialValue must be greater than 0');
  });

  it('should handle very small but positive ratio', () => {
    // Very small ratio should work but get 0 allocated slots
    const manager = createTestManager(
      {
        tinyRatio: { ratio: 0.001 },
        normalRatio: { ratio: 0.999 },
      },
      TEN
    );

    try {
      const tinyState = manager.getState('tinyRatio');
      const normalState = manager.getState('normalRatio');

      // Tiny ratio type should get 0 slots (floor of 0.01)
      expect(tinyState?.allocatedSlots).toBe(ZERO);

      // Normal type should get most capacity
      expect(normalState?.allocatedSlots).toBe(TEN - ONE); // 9 slots

      // Tiny ratio type cannot acquire
      expect(manager.acquire('tinyRatio')).toBe(false);
    } finally {
      manager.stop();
    }
  });

  it('should handle ratio exactly 1.0 (100% allocation)', () => {
    const manager = createTestManager({ singleType: { ratio: ONE } }, TEN);

    try {
      const state = manager.getState('singleType');

      // Single type with ratio 1.0 should get all capacity
      expect(state?.allocatedSlots).toBe(TEN);
      expect(state?.currentRatio).toBe(ONE);

      // Should be able to acquire all slots
      for (let i = ZERO; i < TEN; i++) {
        expect(manager.acquire('singleType')).toBe(true);
      }
      expect(manager.acquire('singleType')).toBe(false); // No more capacity
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Configuration - Large Capacity', () => {
  it('should handle extremely high capacity without overflow', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, MILLION);

    try {
      const state = manager.getState('typeA');
      expect(state?.allocatedSlots).toBe(MILLION);

      // Should be able to acquire many slots
      for (let i = ZERO; i < HUNDRED; i++) {
        expect(manager.acquire('typeA')).toBe(true);
      }
      expect(manager.getState('typeA')?.inFlight).toBe(HUNDRED);
    } finally {
      manager.stop();
    }
  });

  it('should handle capacity change to very large value', () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN);

    try {
      // Initial small capacity
      expect(manager.getState('typeA')?.allocatedSlots).toBe(FIVE);

      // Change to very large capacity
      manager.setTotalCapacity(MILLION);

      // Both types should scale proportionally
      const stateA = manager.getState('typeA');
      const stateB = manager.getState('typeB');

      expect(stateA?.allocatedSlots).toBe(MILLION / 2);
      expect(stateB?.allocatedSlots).toBe(MILLION / 2);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Configuration - With Job Type', () => {
  it('should handle job with jobType when resourceEstimationsPerJob is configured', async () => {
    const limiter = createTestLimiter({
      capacity: TEN,
      jobTypes: { typeA: { ratio: ONE } },
    });

    try {
      // Queue a job WITH specifying jobType
      // The limiter should process it with job type tracking
      const result = await limiter.queueJob({
        jobId: 'typed-job',
        jobType: 'typeA',
        job: createSimpleTestJob(),
      });

      expect(result).toBeDefined();
      expect(result.modelUsed).toBe('model1');
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Configuration - With resourceEstimationsPerJob', () => {
  it('should work with default resourceEstimationsPerJob configured', async () => {
    // Create limiter with default job type configuration
    const limiter = createLLMRateLimiter({
      models: {
        model1: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          pricing: DEFAULT_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        default: { estimatedNumberOfRequests: ONE },
      },
    });

    try {
      // Should work with default job type
      const result = await limiter.queueJob({
        jobId: 'simple-job',
        jobType: 'default',
        job: createSimpleTestJob(),
      });

      expect(result).toBeDefined();

      // Job type stats should be defined when resourceEstimationsPerJob is configured
      const stats = limiter.getJobTypeStats();
      expect(stats).toBeDefined();
    } finally {
      limiter.stop();
    }
  });

  it('should handle jobType that matches resourceEstimationsPerJob configuration', async () => {
    // Create limiter with resourceEstimationsPerJob
    const limiter = createLLMRateLimiter({
      models: {
        model1: {
          requestsPerMinute: HIGH_RPM,
          maxConcurrentRequests: TEN,
          pricing: DEFAULT_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        someType: { estimatedNumberOfRequests: ONE },
      },
    });

    try {
      // Specifying jobType that matches config should work
      const result = await limiter.queueJob({
        jobId: 'typed-job',
        jobType: 'someType',
        job: createSimpleTestJob(),
      });

      expect(result).toBeDefined();
    } finally {
      limiter.stop();
    }
  });
});

describe('Job Types Configuration - Multiple Types Same Ratio', () => {
  it('should handle multiple types with identical ratios', () => {
    const manager = createTestManager(
      {
        typeA: { ratio: 0.25 },
        typeB: { ratio: 0.25 },
        typeC: { ratio: 0.25 },
        typeD: { ratio: 0.25 },
      },
      HUNDRED
    );

    try {
      // All types should get equal allocation
      const stateA = manager.getState('typeA');
      const stateB = manager.getState('typeB');
      const stateC = manager.getState('typeC');
      const stateD = manager.getState('typeD');

      const expectedSlots = 25; // 0.25 * 100

      expect(stateA?.allocatedSlots).toBe(expectedSlots);
      expect(stateB?.allocatedSlots).toBe(expectedSlots);
      expect(stateC?.allocatedSlots).toBe(expectedSlots);
      expect(stateD?.allocatedSlots).toBe(expectedSlots);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Configuration - Ratio Adjustment Config', () => {
  it('should use default ratio adjustment config when not specified', () => {
    const manager = createTestManager({ typeA: { ratio: ONE } }, TEN);

    try {
      // Manager should work with default config
      expect(manager.getState('typeA')).toBeDefined();

      // Adjustment should not crash
      manager.adjustRatios();

      expect(manager.getState('typeA')?.currentRatio).toBe(ONE);
    } finally {
      manager.stop();
    }
  });

  it('should handle partial ratio adjustment config', () => {
    const manager = createTestManager({ typeA: { ratio: RATIO_HALF }, typeB: { ratio: RATIO_HALF } }, TEN, {
      // Only specify some fields
      maxAdjustment: 0.1,
      // Other fields use defaults
    });

    try {
      expect(manager.getState('typeA')).toBeDefined();
      expect(manager.getState('typeB')).toBeDefined();

      // Should work with partial config
      manager.adjustRatios();
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types Configuration - Edge Case Ratios', () => {
  it('should handle very small ratios that round to same slot count', () => {
    // With capacity 10 and ratios 0.11, 0.12, 0.77
    // floor(0.11 * 10) = 1, floor(0.12 * 10) = 1, floor(0.77 * 10) = 7
    // Total: 9 slots (1 wasted due to rounding)
    const manager = createTestManager(
      {
        type1: { ratio: 0.11 },
        type2: { ratio: 0.12 },
        type3: { ratio: 0.77 },
      },
      TEN
    );

    try {
      const state1 = manager.getState('type1');
      const state2 = manager.getState('type2');
      const state3 = manager.getState('type3');

      // Small types should get 1 slot each (floor of 1.1 and 1.2)
      expect(state1?.allocatedSlots).toBe(ONE);
      expect(state2?.allocatedSlots).toBe(ONE);
      // Large type gets floor(7.7) = 7 slots
      expect(state3?.allocatedSlots).toBe(TEN - 2 - ONE); // 7 slots

      // Total slots used: 1 + 1 + 7 = 9 (1 slot wasted due to floor rounding)
      const totalSlots =
        (state1?.allocatedSlots ?? ZERO) +
        (state2?.allocatedSlots ?? ZERO) +
        (state3?.allocatedSlots ?? ZERO);
      expect(totalSlots).toBeLessThanOrEqual(TEN);
    } finally {
      manager.stop();
    }
  });
});
