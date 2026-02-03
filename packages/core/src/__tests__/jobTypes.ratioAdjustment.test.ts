/**
 * Tests for dynamic ratio adjustment in job types.
 */
import { describe, expect, it } from '@jest/globals';
import { setTimeout as sleep } from 'node:timers/promises';

import type { RatioAdjustmentConfig, ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import { type JobTypeManager, createJobTypeManager } from '../utils/jobTypeManager.js';

const ZERO = 0;
const ONE = 1;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const HUNDRED = 100;
const RATIO_05 = 0.5;
const RATIO_04 = 0.4;
const RATIO_03 = 0.3;
const RATIO_02 = 0.2;
const RATIO_015 = 0.15;
const RATIO_01 = 0.1;
const RATIO_005 = 0.05;
const HIGH_LOAD_08 = 0.8;
const HIGH_LOAD_07 = 0.7;
const LOW_LOAD_03 = 0.3;
const LOW_LOAD_02 = 0.2;
const ADJUSTMENT_INTERVAL_MS = 50;

const createManager = (
  resourceEstimationsPerJob: ResourceEstimationsPerJob,
  ratioConfig?: RatioAdjustmentConfig,
  capacity?: number
): JobTypeManager => {
  const manager = createJobTypeManager({
    resourceEstimationsPerJob,
    ratioAdjustmentConfig: ratioConfig,
    label: 'test',
  });
  if (capacity !== undefined) manager.setTotalCapacity(capacity);
  return manager;
};

const acquireAll = (manager: JobTypeManager, jobType: string): void => {
  const slots = manager.getState(jobType)?.allocatedSlots ?? ZERO;
  for (let i = ZERO; i < slots; i += ONE) manager.acquire(jobType);
};

const releaseAll = (manager: JobTypeManager, jobType: string): void => {
  const inFlight = manager.getState(jobType)?.inFlight ?? ZERO;
  for (let i = ZERO; i < inFlight; i += ONE) manager.release(jobType);
};

describe('Job Types - Ratio Adjustment Basic', () => {
  it('should adjust ratios when high load job type needs more capacity', () => {
    const config = {
      highLoadThreshold: HIGH_LOAD_08,
      lowLoadThreshold: LOW_LOAD_03,
      maxAdjustment: RATIO_01,
      minRatio: RATIO_005,
    };
    const manager = createManager(
      {
        highLoad: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
        lowLoad: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
        idle: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
      },
      config,
      HUNDRED
    );

    try {
      acquireAll(manager, 'highLoad');
      manager.adjustRatios();
      expect(manager.getState('highLoad')?.currentRatio).toBeGreaterThan(RATIO_03);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Non-Flexible Adjustment', () => {
  it('should NOT adjust non-flexible job type ratios', () => {
    const config = {
      highLoadThreshold: HIGH_LOAD_08,
      lowLoadThreshold: LOW_LOAD_03,
      maxAdjustment: RATIO_02,
      minRatio: RATIO_005,
    };
    const manager = createManager(
      {
        flexibleHigh: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
        nonFlexible: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04, flexible: false } },
        flexibleLow: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
      },
      config,
      HUNDRED
    );

    try {
      acquireAll(manager, 'flexibleHigh');
      for (let i = ZERO; i < FIVE; i += ONE) manager.adjustRatios();
      expect(manager.getState('nonFlexible')?.currentRatio).toBe(RATIO_04);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Periodic Adjustment', () => {
  it('should trigger periodic adjustment based on interval', async () => {
    const config = {
      highLoadThreshold: HIGH_LOAD_08,
      lowLoadThreshold: LOW_LOAD_03,
      adjustmentIntervalMs: ADJUSTMENT_INTERVAL_MS,
    };
    const manager = createManager(
      {
        jobA: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
        jobB: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      },
      config,
      TEN
    );

    try {
      acquireAll(manager, 'jobA');
      const initialRatioB = manager.getState('jobB')?.currentRatio ?? ZERO;
      await sleep(ADJUSTMENT_INTERVAL_MS * THREE);
      expect(manager.getState('jobB')?.currentRatio).toBeLessThan(initialRatioB);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Non-Flexible Preservation', () => {
  it('should preserve non-flexible ratio across cycles', () => {
    const config = {
      highLoadThreshold: HIGH_LOAD_07,
      lowLoadThreshold: LOW_LOAD_02,
      maxAdjustment: RATIO_015,
      minRatio: RATIO_005,
    };
    const manager = createManager(
      {
        critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_02, flexible: false } },
        normal1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
        normal2: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_04 } },
      },
      config,
      HUNDRED
    );

    try {
      for (let cycle = ZERO; cycle < TEN; cycle += ONE) {
        acquireAll(manager, 'normal1');
        manager.adjustRatios();
        releaseAll(manager, 'normal1');
      }
      expect(manager.getState('critical')?.currentRatio).toBeCloseTo(RATIO_02, TEN);
    } finally {
      manager.stop();
    }
  });
});

describe('Job Types - Non-Flexible As Donor', () => {
  it('should not use non-flexible job types as donors', () => {
    const config = {
      highLoadThreshold: HIGH_LOAD_08,
      lowLoadThreshold: LOW_LOAD_03,
      maxAdjustment: RATIO_02,
      minRatio: RATIO_005,
    };
    const manager = createManager(
      {
        nonFlexibleIdle: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05, flexible: false } },
        flexibleHigh: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      },
      config,
      TEN
    );

    try {
      acquireAll(manager, 'flexibleHigh');
      for (let i = ZERO; i < TEN; i += ONE) manager.adjustRatios();
      expect(manager.getState('nonFlexibleIdle')?.currentRatio).toBe(RATIO_05);
    } finally {
      manager.stop();
    }
  });
});
