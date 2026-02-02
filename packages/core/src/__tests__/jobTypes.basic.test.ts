/**
 * Basic job type tests for the LLM Rate Limiter.
 */
import { describe, expect, it } from '@jest/globals';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import { createJobTypeManager } from '../utils/jobTypeManager.js';
import {
  calculateInitialRatios,
  validateJobTypeConfig,
  validateJobTypeExists,
} from '../utils/jobTypeValidation.js';
import {
  DEFAULT_PRICING,
  ONE,
  RPM_LIMIT_HIGH,
  createMockJobResult,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

const TEN = 10;
const HUNDRED = 100;
const THOUSAND = 1000;
const TWO = 2;
const THREE = 3;
const ZERO = 0;
const HALF = 0.5;
const THIRD = 0.333;
const RATIO_03 = 0.3;
const RATIO_04 = 0.4;
const RATIO_05 = 0.5;
const RATIO_06 = 0.6;
const RATIO_07 = 0.7;
const RATIO_02 = 0.2;
const RATIO_15 = 1.5;

const MODEL_CONFIG = {
  model1: {
    requestsPerMinute: RPM_LIMIT_HIGH,
    resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    pricing: DEFAULT_PRICING,
  },
};

describe('Job type validation - config errors', () => {
  it('should validate at least one job type is defined', () => {
    expect(() => {
      validateJobTypeConfig({});
    }).toThrow('resourcesPerJob must contain at least one job type');
  });

  it('should validate ratio value is at most 1', () => {
    expect(() => {
      validateJobTypeConfig({ job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_15 } } });
    }).toThrow('ratio.initialValue must be at most 1');
  });

  it('should validate ratio value is greater than 0', () => {
    expect(() => {
      validateJobTypeConfig({ job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: ZERO } } });
    }).toThrow('ratio.initialValue must be greater than 0');
  });

  it('should validate ratio sum does not exceed 1', () => {
    expect(() => {
      validateJobTypeConfig({
        job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_07 } },
        job2: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      });
    }).toThrow('Sum of specified ratio.initialValue values exceeds 1');
  });

  it('should accept valid configuration', () => {
    expect(() => {
      validateJobTypeConfig({
        job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_07 } },
        job2: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_03 } },
      });
    }).not.toThrow();
  });
});

describe('Job type validation - ratio calculation', () => {
  it('should calculate initial ratios correctly', () => {
    const result = calculateInitialRatios({
      job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_06 } },
      job2: { estimatedUsedTokens: HUNDRED },
      job3: { estimatedUsedTokens: HUNDRED },
    });
    expect(result.ratios.get('job1')).toBe(RATIO_06);
    expect(result.ratios.get('job2')).toBeCloseTo(RATIO_02, TWO);
    expect(result.ratios.get('job3')).toBeCloseTo(RATIO_02, TWO);
  });

  it('should evenly distribute when no ratios specified', () => {
    const result = calculateInitialRatios({
      job1: { estimatedUsedTokens: HUNDRED },
      job2: { estimatedUsedTokens: HUNDRED },
    });
    expect(result.ratios.get('job1')).toBe(HALF);
    expect(result.ratios.get('job2')).toBe(HALF);
  });

  it('should validate job type exists', () => {
    const resourcesPerJob = {
      job1: { estimatedUsedTokens: HUNDRED },
      job2: { estimatedUsedTokens: HUNDRED },
    };
    expect(() => {
      validateJobTypeExists('job1', resourcesPerJob);
    }).not.toThrow();
    expect(() => {
      validateJobTypeExists('job3', resourcesPerJob);
    }).toThrow("Unknown job type 'job3'");
  });
});

describe('JobTypeManager - initialization', () => {
  it('should create manager with initial states', () => {
    const manager = createJobTypeManager({
      resourcesPerJob: {
        job1: { estimatedUsedTokens: THOUSAND, ratio: { initialValue: RATIO_06 } },
        job2: { estimatedUsedTokens: HUNDRED },
      },
      label: 'test',
    });
    const stats = manager.getStats();
    expect(Object.keys(stats.jobTypes)).toHaveLength(TWO);
    expect(stats.jobTypes.job1?.currentRatio).toBe(RATIO_06);
    expect(stats.jobTypes.job2?.currentRatio).toBeCloseTo(RATIO_04, TWO);
    manager.stop();
  });
});

describe('JobTypeManager - acquire and release', () => {
  it('should acquire and release slots', () => {
    const manager = createJobTypeManager({
      resourcesPerJob: { job1: { estimatedUsedTokens: HUNDRED } },
      label: 'test',
    });
    manager.setTotalCapacity(TEN);
    expect(manager.hasCapacity('job1')).toBe(true);
    expect(manager.acquire('job1')).toBe(true);
    expect(manager.getState('job1')?.inFlight).toBe(ONE);
    manager.release('job1');
    expect(manager.getState('job1')?.inFlight).toBe(ZERO);
    manager.stop();
  });

  it('should return undefined for unknown job type', () => {
    const manager = createJobTypeManager({
      resourcesPerJob: { job1: { estimatedUsedTokens: HUNDRED } },
      label: 'test',
    });
    expect(manager.getState('unknown')).toBeUndefined();
    expect(manager.hasCapacity('unknown')).toBe(false);
    expect(manager.acquire('unknown')).toBe(false);
    manager.stop();
  });
});

describe('JobTypeManager - capacity limits', () => {
  it('should respect allocated slots', () => {
    const manager = createJobTypeManager({
      resourcesPerJob: {
        job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
        job2: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_05 } },
      },
      label: 'test',
    });
    manager.setTotalCapacity(TWO);
    expect(manager.getState('job1')?.allocatedSlots).toBe(ONE);
    expect(manager.getState('job2')?.allocatedSlots).toBe(ONE);
    expect(manager.acquire('job1')).toBe(true);
    expect(manager.acquire('job1')).toBe(false);
    expect(manager.hasCapacity('job1')).toBe(false);
    expect(manager.hasCapacity('job2')).toBe(true);
    manager.stop();
  });
});

describe('Rate limiter with job types - stats', () => {
  it('should create limiter with job types and include in stats', () => {
    const limiter = createLLMRateLimiter({
      models: MODEL_CONFIG,
      resourcesPerJob: {
        'summarize-pdf': { estimatedUsedTokens: THOUSAND },
        'create-recipe': { estimatedUsedTokens: HUNDRED },
      },
    });
    expect(limiter.getJobTypeStats()).toBeDefined();
    const stats = limiter.getStats();
    expect(stats.jobTypes).toBeDefined();
    expect(stats.jobTypes?.jobTypes['summarize-pdf']).toBeDefined();
    expect(stats.jobTypes?.jobTypes['create-recipe']).toBeDefined();
    limiter.stop();
  });

  it('should include job types with correct ratios in stats', () => {
    const limiter = createLLMRateLimiter({
      models: MODEL_CONFIG,
      resourcesPerJob: {
        job1: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: THIRD } },
        job2: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: THIRD } },
        job3: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: THIRD } },
      },
    });
    const stats = limiter.getStats();
    expect(stats.jobTypes).toBeDefined();
    expect(Object.keys(stats.jobTypes?.jobTypes ?? {})).toHaveLength(THREE);
    expect(stats.jobTypes?.jobTypes.job1?.currentRatio).toBeCloseTo(THIRD, TWO);
    limiter.stop();
  });
});

describe('Rate limiter with job types - backward compatibility', () => {
  it('should work without job types (backward compatible)', async () => {
    const limiter = createLLMRateLimiter({ models: MODEL_CONFIG });
    const result = await limiter.queueJob(simpleJob(createMockJobResult('test-result')));
    expect(result.modelUsed).toBe('model1');
    expect(limiter.getJobTypeStats()).toBeUndefined();
    limiter.stop();
  });
});

// Note: Testing unknown job type at runtime is not possible with strict TypeScript
// as the type system correctly prevents invalid job types at compile time.
// The validation is covered by validateJobTypeExists tests above.
