/**
 * Shared helpers for branch coverage tests.
 */
import type { LLMRateLimiterStats } from '../multiModelTypes.js';
import { AvailabilityTracker } from '../utils/availabilityTracker.js';

export const ZERO = 0;
export const ONE = 1;
export const TEN = 10;
export const FIFTY = 50;
export const HUNDRED = 100;
export const THOUSAND = 1000;
export const RATIO_HALF = 0.5;

/** Config type for testing internal access */
export interface TestableConfig {
  models: Record<string, { pricing?: unknown }>;
}

/** Estimated resources for tracker tests */
export interface EstResources {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  estimatedUsedMemoryKB: number;
}

/** Result of creating a change tracker */
export interface TrackerResult {
  tracker: AvailabilityTracker;
  calls: string[];
}

/** Create a tracker that records callback reasons */
export const createChangeTracker = (
  getStats: () => LLMRateLimiterStats,
  estimated: EstResources
): TrackerResult => {
  const calls: string[] = [];
  const tracker = new AvailabilityTracker({
    callback: (_availability, reason, _modelId) => {
      calls.push(reason);
    },
    getStats,
    estimatedResources: estimated,
  });
  return { tracker, calls };
};

/** Create a basic limiter config */
export const createBasicModelConfig = (rpm: number = TEN): Record<string, unknown> => ({
  default: {
    requestsPerMinute: rpm,
    resourcesPerEvent: { estimatedNumberOfRequests: ONE },
    pricing: { input: ZERO, cached: ZERO, output: ZERO },
  },
});
