/**
 * Coverage tests for AvailabilityTracker.
 */
import type { LLMRateLimiterStats, RelativeAvailabilityAdjustment } from '../multiModelTypes.js';
import { AvailabilityTracker } from '../utils/availabilityTracker.js';
import { FIFTY, HUNDRED, ONE, TEN, THOUSAND, ZERO, createMockStats } from './coverage.helpers.js';

describe('availabilityTracker - getCurrentAvailability', () => {
  it('should call getCurrentAvailability', () => {
    const tracker = new AvailabilityTracker({
      callback: undefined,
      getStats: (): LLMRateLimiterStats => createMockStats(),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    const availability = tracker.getCurrentAvailability();
    expect(availability.slots).toBeGreaterThan(ZERO);
  });
});

describe('availabilityTracker - change detection', () => {
  it('should detect tokensPerMinute change', () => {
    let statsTokens = HUNDRED;
    const calls: string[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_availability, reason, _modelId) => {
        calls.push(reason);
      },
      getStats: () => ({
        models: {
          default: {
            tokensPerMinute: { current: ZERO, limit: HUNDRED, remaining: statsTokens, resetsInMs: THOUSAND },
          },
        },
      }),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    tracker.initialize();
    statsTokens = FIFTY;
    tracker.checkAndEmit('tokensMinute', 'default');
    expect(calls.includes('tokensMinute')).toBe(true);
  });
});

interface CallRecord {
  reason: string;
  adjustment: RelativeAvailabilityAdjustment | undefined;
}

describe('availabilityTracker - adjustment callback', () => {
  it('should handle checkAndEmit with adjustment', () => {
    const calls: CallRecord[] = [];
    const tracker = new AvailabilityTracker({
      callback: (_availability, reason, _modelId, adjustment) => {
        calls.push({ reason, adjustment });
      },
      getStats: (): LLMRateLimiterStats => createMockStats(),
      estimatedResources: {
        estimatedUsedTokens: TEN,
        estimatedNumberOfRequests: ONE,
        estimatedUsedMemoryKB: ZERO,
      },
    });
    const adjustment: RelativeAvailabilityAdjustment = {
      tokensPerMinute: -TEN,
      tokensPerDay: -TEN,
      requestsPerMinute: ZERO,
      requestsPerDay: ZERO,
      memoryKB: ZERO,
      concurrentRequests: ZERO,
    };
    tracker.checkAndEmit('adjustment', 'default', adjustment);
    expect(calls.some((c) => c.reason === 'adjustment' && c.adjustment !== undefined)).toBe(true);
  });
});
