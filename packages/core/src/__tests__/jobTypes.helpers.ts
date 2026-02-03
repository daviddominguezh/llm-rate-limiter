/**
 * Shared test helpers for comprehensive job type testing.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';
import type { JobTypeManager } from '../utils/jobTypeManager.js';
import { createJobTypeManager } from '../utils/jobTypeManager.js';

// ============================================================================
// Constants
// ============================================================================

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const FIVE = 5;
export const TEN = 10;
export const TWENTY = 20;
export const FIFTY = 50;
export const HUNDRED = 100;
export const THOUSAND = 1000;

// Timing constants
export const INVARIANT_CHECK_INTERVAL_MS = 5;
export const SHORT_DELAY_MS = 5;
export const MEDIUM_DELAY_MS = 20;
export const LONG_DELAY_MS = 100;

// Ratio constants
export const RATIO_FULL = 1.0;
export const RATIO_099 = 0.99;
export const RATIO_09 = 0.9;
export const RATIO_077 = 0.77;
export const RATIO_06 = 0.6;
export const RATIO_HALF = 0.5;
export const RATIO_04 = 0.4;
export const RATIO_034 = 0.34;
export const RATIO_THIRD = 0.33;
export const RATIO_03 = 0.3;
export const RATIO_QUARTER = 0.25;
export const RATIO_02 = 0.2;
export const RATIO_012 = 0.12;
export const RATIO_011 = 0.11;
export const RATIO_TENTH = 0.1;
export const RATIO_TINY = 0.01;
export const RATIO_0001 = 0.001;
export const RATIO_0999 = 0.999;

// Tolerance for floating point comparisons
export const EPSILON = 0.0001;

// Default pricing for test models
export const DEFAULT_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

// RPM high enough to not interfere with tests
export const HIGH_RPM = 100000;

// Sleep helper to avoid promise/avoid-new lint errors
export const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

// ============================================================================
// Types
// ============================================================================

export interface UsageResult {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export type ResolveFunction = (result: UsageResult) => void;

export type JobFn = (
  ctx: { modelId: string },
  resolve: ResolveFunction
) => InternalJobResult | Promise<InternalJobResult>;

export interface ManagerSnapshot {
  states: Record<string, { inFlight: number; allocatedSlots: number; currentRatio: number }>;
  totalCapacity: number;
}

export interface InvariantViolation {
  type: 'inFlight_exceeds_allocated' | 'negative_inFlight' | 'ratio_sum_invalid' | 'slots_exceed_capacity';
  jobType?: string;
  details: string;
  timestamp: number;
}

export interface InvariantChecker {
  violations: InvariantViolation[];
  checkCount: number;
  check: () => void;
  startContinuousCheck: (intervalMs: number) => void;
  stop: () => void;
  assertNoViolations: () => void;
}

// ============================================================================
// Invariant Checker
// ============================================================================

export const createInvariantChecker = (manager: JobTypeManager): InvariantChecker => {
  const violations: InvariantViolation[] = [];
  const state = { checkCount: ZERO };
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const check = (): void => {
    state.checkCount += ONE;
    const states = manager.getAllStates();
    const totalCapacity = manager.getTotalCapacity();
    let ratioSum = ZERO;
    let slotsSum = ZERO;

    for (const [jobTypeId, jobState] of Object.entries(states)) {
      // Check inFlight <= allocatedSlots
      if (jobState.inFlight > jobState.allocatedSlots) {
        violations.push({
          type: 'inFlight_exceeds_allocated',
          jobType: jobTypeId,
          details: `inFlight=${jobState.inFlight} > allocatedSlots=${jobState.allocatedSlots}`,
          timestamp: Date.now(),
        });
      }

      // Check inFlight >= 0
      if (jobState.inFlight < ZERO) {
        violations.push({
          type: 'negative_inFlight',
          jobType: jobTypeId,
          details: `inFlight=${jobState.inFlight} is negative`,
          timestamp: Date.now(),
        });
      }

      ratioSum += jobState.currentRatio;
      slotsSum += jobState.allocatedSlots;
    }

    // Check sum of ratios ≈ 1
    if (Math.abs(ratioSum - ONE) > EPSILON) {
      violations.push({
        type: 'ratio_sum_invalid',
        details: `Sum of ratios=${ratioSum}, expected 1.0`,
        timestamp: Date.now(),
      });
    }

    // Check sum of slots <= capacity
    if (slotsSum > totalCapacity) {
      violations.push({
        type: 'slots_exceed_capacity',
        details: `Sum of slots=${slotsSum} > capacity=${totalCapacity}`,
        timestamp: Date.now(),
      });
    }
  };

  const startContinuousCheck = (intervalMs: number): void => {
    if (intervalId !== null) return;
    intervalId = setInterval(check, intervalMs);
  };

  const stop = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  const assertNoViolations = (): void => {
    if (violations.length > ZERO) {
      const msg = violations.map((v) => `[${v.type}] ${v.details}`).join('\n');
      throw new Error(`Invariant violations detected (${violations.length}):\n${msg}`);
    }
  };

  return {
    violations,
    get checkCount(): number {
      return state.checkCount;
    },
    check,
    startContinuousCheck,
    stop,
    assertNoViolations,
  };
};

// ============================================================================
// State Snapshot Utilities
// ============================================================================

export const captureManagerState = (manager: JobTypeManager): ManagerSnapshot => {
  const allStates = manager.getAllStates();
  const states: ManagerSnapshot['states'] = {};

  for (const [jobTypeId, state] of Object.entries(allStates)) {
    states[jobTypeId] = {
      inFlight: state.inFlight,
      allocatedSlots: state.allocatedSlots,
      currentRatio: state.currentRatio,
    };
  }

  return { states, totalCapacity: manager.getTotalCapacity() };
};

export const assertStateUnchanged = (before: ManagerSnapshot, after: ManagerSnapshot): void => {
  for (const [jobTypeId, beforeState] of Object.entries(before.states)) {
    const afterState = after.states[jobTypeId];
    if (afterState === undefined) {
      throw new Error(`Job type ${jobTypeId} missing after operation`);
    }
    if (beforeState.inFlight !== afterState.inFlight) {
      throw new Error(`inFlight changed for ${jobTypeId}: ${beforeState.inFlight} -> ${afterState.inFlight}`);
    }
    if (beforeState.allocatedSlots !== afterState.allocatedSlots) {
      throw new Error(
        `allocatedSlots changed for ${jobTypeId}: ${beforeState.allocatedSlots} -> ${afterState.allocatedSlots}`
      );
    }
  }
};

// ============================================================================
// Job Factories
// ============================================================================

/** Creates a simple job that completes immediately */
export const createSimpleTestJob =
  (inputTokens: number = TEN, outputTokens: number = FIVE): JobFn =>
  (ctx: { modelId: string }, resolve: ResolveFunction): InternalJobResult => {
    resolve({ modelId: ctx.modelId, inputTokens, cachedTokens: ZERO, outputTokens });
    return { requestCount: ONE, usage: { input: inputTokens, output: outputTokens, cached: ZERO } };
  };

/** Creates a job that takes some time to complete */
export const createDelayedJob =
  (delayMs: number, inputTokens: number = TEN): JobFn =>
  async (ctx: { modelId: string }, resolve: ResolveFunction): Promise<InternalJobResult> => {
    resolve({ modelId: ctx.modelId, inputTokens, cachedTokens: ZERO, outputTokens: FIVE });
    await new Promise((r) => setTimeout(r, delayMs));
    return { requestCount: ONE, usage: { input: inputTokens, output: FIVE, cached: ZERO } };
  };

/** Creates a job that throws synchronously */
export const createThrowingJob =
  (errorMessage: string): JobFn =>
  (_ctx: { modelId: string }, _resolve: ResolveFunction): InternalJobResult => {
    throw new Error(errorMessage);
  };

/** Creates a job that throws after a delay */
export const createDelayedThrowingJob =
  (delayMs: number, errorMessage: string): JobFn =>
  async (_ctx: { modelId: string }, _resolve: ResolveFunction): Promise<InternalJobResult> => {
    await new Promise((r) => setTimeout(r, delayMs));
    throw new Error(errorMessage);
  };

/** Creates a job that rejects its promise */
export const createRejectingJob =
  (errorMessage: string): JobFn =>
  async (_ctx: { modelId: string }, _resolve: ResolveFunction): Promise<InternalJobResult> =>
    await Promise.reject(new Error(errorMessage));

/** Creates a job that never resolves (for timeout testing) */
export const createHangingJob =
  (): JobFn =>
  async (_ctx: { modelId: string }, _resolve: ResolveFunction): Promise<InternalJobResult> =>
    await new Promise(() => {
      /* never resolves */
    });

// ============================================================================
// Limiter & Manager Creation Helpers
// ============================================================================

export interface TestLimiterConfig {
  capacity: number;
  jobTypes: Record<string, { ratio?: number; flexible?: boolean }>;
  ratioAdjustmentConfig?: {
    highLoadThreshold?: number;
    lowLoadThreshold?: number;
    maxAdjustment?: number;
    minRatio?: number;
    adjustmentIntervalMs?: number;
    releasesPerAdjustment?: number;
  };
}

export const createTestModelConfig = (capacity: number): ModelRateLimitConfig => ({
  requestsPerMinute: HIGH_RPM,
  maxConcurrentRequests: capacity,
  pricing: DEFAULT_PRICING,
});

export const createTestLimiter = (config: TestLimiterConfig): LLMRateLimiterInstance => {
  const resourceEstimationsPerJob: Record<
    string,
    { estimatedUsedTokens: number; ratio?: { initialValue: number; flexible?: boolean } }
  > = {};

  for (const [jobType, cfg] of Object.entries(config.jobTypes)) {
    resourceEstimationsPerJob[jobType] = {
      estimatedUsedTokens: HUNDRED,
      ratio: cfg.ratio !== undefined ? { initialValue: cfg.ratio, flexible: cfg.flexible } : undefined,
    };
  }

  return createLLMRateLimiter({
    models: { model1: createTestModelConfig(config.capacity) },
    resourceEstimationsPerJob,
    ratioAdjustmentConfig: config.ratioAdjustmentConfig,
  });
};

export const createTestManager = (
  jobTypes: Record<string, { ratio?: number; flexible?: boolean }>,
  capacity: number = TEN,
  ratioAdjustmentConfig?: TestLimiterConfig['ratioAdjustmentConfig']
): JobTypeManager => {
  const resourceEstimationsPerJob: Record<
    string,
    { estimatedUsedTokens: number; ratio?: { initialValue: number; flexible?: boolean } }
  > = {};

  for (const [jobType, cfg] of Object.entries(jobTypes)) {
    resourceEstimationsPerJob[jobType] = {
      estimatedUsedTokens: HUNDRED,
      ratio: cfg.ratio !== undefined ? { initialValue: cfg.ratio, flexible: cfg.flexible } : undefined,
    };
  }

  const manager = createJobTypeManager({
    resourceEstimationsPerJob,
    ratioAdjustmentConfig,
    label: 'test',
  });
  manager.setTotalCapacity(capacity);
  return manager;
};

// ============================================================================
// Concurrent Execution Helpers
// ============================================================================

export interface ConcurrentTracker {
  inFlight: Map<string, number>;
  peakInFlight: Map<string, number>;
  completed: Map<string, number>;
  errors: Error[];
}

export const createConcurrentTracker = (): ConcurrentTracker => ({
  inFlight: new Map(),
  peakInFlight: new Map(),
  completed: new Map(),
  errors: [],
});

export const trackJobStart = (tracker: ConcurrentTracker, jobType: string): void => {
  const current = (tracker.inFlight.get(jobType) ?? ZERO) + ONE;
  tracker.inFlight.set(jobType, current);
  tracker.peakInFlight.set(jobType, Math.max(tracker.peakInFlight.get(jobType) ?? ZERO, current));
};

export const trackJobEnd = (tracker: ConcurrentTracker, jobType: string): void => {
  tracker.inFlight.set(jobType, (tracker.inFlight.get(jobType) ?? ONE) - ONE);
  tracker.completed.set(jobType, (tracker.completed.get(jobType) ?? ZERO) + ONE);
};

export const trackJobError = (tracker: ConcurrentTracker, error: Error): void => {
  tracker.errors.push(error);
};

/** Creates a tracked job that updates the tracker during execution */
export const createTrackedJob =
  (tracker: ConcurrentTracker, jobType: string, delayMs: number = ZERO): JobFn =>
  async (ctx: { modelId: string }, resolve: ResolveFunction): Promise<InternalJobResult> => {
    trackJobStart(tracker, jobType);
    try {
      resolve({ modelId: ctx.modelId, inputTokens: TEN, cachedTokens: ZERO, outputTokens: FIVE });
      if (delayMs > ZERO) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return { requestCount: ONE, usage: { input: TEN, output: FIVE, cached: ZERO } };
    } finally {
      trackJobEnd(tracker, jobType);
    }
  };

// ============================================================================
// Assertion Helpers
// ============================================================================

export const assertInFlightZero = (manager: JobTypeManager, jobType: string): void => {
  const state = manager.getState(jobType);
  if (state === undefined) {
    throw new Error(`Job type ${jobType} not found`);
  }
  if (state.inFlight !== ZERO) {
    throw new Error(`Expected inFlight=0 for ${jobType}, got ${state.inFlight}`);
  }
};

export const assertAllInFlightZero = (manager: JobTypeManager): void => {
  const states = manager.getAllStates();
  for (const [jobType, state] of Object.entries(states)) {
    if (state.inFlight !== ZERO) {
      throw new Error(`Expected inFlight=0 for ${jobType}, got ${state.inFlight}`);
    }
  }
};

export const sumRatios = (manager: JobTypeManager): number => {
  const states = manager.getAllStates();
  let sum = ZERO;
  for (const state of Object.values(states)) {
    sum += state.currentRatio;
  }
  return sum;
};

export const sumAllocatedSlots = (manager: JobTypeManager): number => {
  const states = manager.getAllStates();
  let sum = ZERO;
  for (const state of Object.values(states)) {
    sum += state.allocatedSlots;
  }
  return sum;
};
