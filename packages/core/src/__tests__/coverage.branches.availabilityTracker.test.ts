/**
 * Branch coverage tests for AvailabilityTracker.
 */
import { AvailabilityTracker } from '../utils/availabilityTracker.js';
import {
  FIFTY,
  HUNDRED,
  ONE,
  TEN,
  THOUSAND,
  ZERO,
  createChangeTracker,
} from './coverage.branches.helpers.js';

/** Create a basic tracker with no callback */
const createBasicTracker = (): AvailabilityTracker =>
  new AvailabilityTracker({
    callback: undefined,
    getStats: () => ({ models: { default: {} } }),
    estimatedResources: {
      estimatedUsedTokens: ZERO,
      estimatedNumberOfRequests: ZERO,
      estimatedUsedMemoryKB: ZERO,
    },
  });

describe('availabilityTracker - null and zero divisors', () => {
  it('should handle null values and zero divisors in slot calculation', () => {
    const tracker = createBasicTracker();
    expect(tracker.getCurrentAvailability().slots).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('availabilityTracker - checkAndEmit no callback', () => {
  it('should return from checkAndEmit when callback is undefined', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => ({
        models: {
          default: {
            tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND },
          },
        },
      }),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    tracker.checkAndEmit('tokensMinute', 'default');
    expect(tracker.getCurrentAvailability().slots).toBeGreaterThan(ZERO);
  });
});

describe('availabilityTracker - hintReason with null previous', () => {
  it('should use hintReason when previousAvailability is null', () => {
    const calls: string[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_availability, reason, _modelId) => {
        calls.push(reason);
      },
      getStats: () => ({
        models: {
          default: {
            tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND },
          },
        },
      }),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    tracker.checkAndEmit('tokensMinute', 'default');
    expect(calls[ZERO]).toBe('tokensMinute');
  });
});

describe('availabilityTracker - emitAdjustment no callback', () => {
  it('should return from emitAdjustment when callback is undefined', () => {
    const tracker = createBasicTracker();
    tracker.emitAdjustment(
      {
        tokensPerMinute: ZERO,
        tokensPerDay: ZERO,
        requestsPerMinute: ZERO,
        requestsPerDay: ZERO,
        memoryKB: ZERO,
        concurrentRequests: ZERO,
      },
      'default'
    );
    expect(tracker.getCurrentAvailability().slots).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('availabilityTracker - tokensPerDay change', () => {
  it('should detect tokensPerDay change', () => {
    let tokensDay = HUNDRED;
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: {
          default: {
            tokensPerDay: { current: ZERO, limit: HUNDRED, remaining: tokensDay, resetsInMs: THOUSAND },
          },
        },
      }),
      { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO }
    );
    tracker.initialize();
    tokensDay = FIFTY;
    tracker.checkAndEmit('tokensDay', 'default');
    expect(calls.includes('tokensDay')).toBe(true);
  });
});

describe('availabilityTracker - requestsPerMinute change', () => {
  it('should detect requestsPerMinute change', () => {
    let reqMin = HUNDRED;
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: {
          default: {
            requestsPerMinute: { current: ZERO, limit: HUNDRED, remaining: reqMin, resetsInMs: THOUSAND },
          },
        },
      }),
      { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO }
    );
    tracker.initialize();
    reqMin = FIFTY;
    tracker.checkAndEmit('requestsMinute', 'default');
    expect(calls.includes('requestsMinute')).toBe(true);
  });
});

describe('availabilityTracker - requestsPerDay change', () => {
  it('should detect requestsPerDay change', () => {
    let reqDay = HUNDRED;
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: {
          default: {
            requestsPerDay: { current: ZERO, limit: HUNDRED, remaining: reqDay, resetsInMs: THOUSAND },
          },
        },
      }),
      { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO }
    );
    tracker.initialize();
    reqDay = FIFTY;
    tracker.checkAndEmit('requestsDay', 'default');
    expect(calls.includes('requestsDay')).toBe(true);
  });
});

describe('availabilityTracker - concurrentRequests change', () => {
  it('should detect concurrentRequests change', () => {
    let conc = TEN;
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: { default: { concurrency: { active: ZERO, limit: TEN, available: conc, waiting: ZERO } } },
      }),
      { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: ZERO }
    );
    tracker.initialize();
    conc = FIFTY;
    tracker.checkAndEmit('concurrentRequests', 'default');
    expect(calls.includes('concurrentRequests')).toBe(true);
  });
});

describe('availabilityTracker - memory change', () => {
  it('should detect memory change', () => {
    let memKB = THOUSAND;
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: { default: {} },
        memory: { activeKB: ZERO, maxCapacityKB: THOUSAND, availableKB: memKB, systemAvailableKB: THOUSAND },
      }),
      { estimatedUsedTokens: ZERO, estimatedNumberOfRequests: ZERO, estimatedUsedMemoryKB: TEN }
    );
    tracker.initialize();
    memKB = HUNDRED;
    tracker.checkAndEmit('memory', 'default');
    expect(calls.includes('memory')).toBe(true);
  });
});

describe('availabilityTracker - skip unchanged', () => {
  it('should skip callback when availability unchanged', () => {
    const { tracker, calls } = createChangeTracker(
      () => ({
        models: {
          default: {
            tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: HUNDRED, resetsInMs: THOUSAND },
          },
        },
      }),
      { estimatedUsedTokens: TEN, estimatedNumberOfRequests: ONE, estimatedUsedMemoryKB: ZERO }
    );
    tracker.initialize();
    tracker.checkAndEmit('tokensMinute', 'default');
    expect(calls.length).toBe(ZERO);
  });
});

describe('availabilityTracker - distributed allocation null', () => {
  it('should return null when no distributed allocation is set', () => {
    const tracker = createBasicTracker();
    expect(tracker.getDistributedAllocation()).toBeNull();
  });
});

describe('availabilityTracker - distributed allocation set', () => {
  it('should return the distributed allocation after setDistributedAllocation', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: () => ({ models: { default: {} } }),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    const allocation = { slots: FIFTY, tokensPerMinute: THOUSAND, requestsPerMinute: HUNDRED };
    tracker.setDistributedAllocation(allocation);
    expect(tracker.getDistributedAllocation()).toEqual(allocation);
  });
});
