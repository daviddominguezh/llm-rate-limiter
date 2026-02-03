/**
 * Helper utilities for the production-like stress test.
 */
import type { RedisBackendInstance } from '../../types.js';
import { delay } from './testSetup.js';

// ============================================================================
// Constants
// ============================================================================

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const HUNDRED = 100;
export const THOUSAND = 1000;
export const TEN = 10;

// Job counts and timing
export const TOTAL_JOBS = 2700;
export const MIN_DURATION_MS = 5000; // 5 seconds
export const MAX_DURATION_MS = 20000; // 20 seconds
export const CAPACITY = 300; // Capacity for long-running jobs
export const INSTANCE_COUNT = 5;

// Failure simulation
export const FAILURE_THRESHOLD = 0.05;

// Traffic pattern (slower for long-running jobs)
export const BURST_DURATION_MS = 5000; // 5 second bursts
export const LULL_DURATION_MS = 1000; // 1 second lulls
export const BURST_JOBS_PER_TICK = 1; // 1 job per tick
export const LULL_JOB_PROBABILITY = 0.3; // Lower probability during lulls
export const TICK_INTERVAL_MS = 50; // 50ms between ticks = 20 jobs/sec max

// Invariant checking
export const INVARIANT_CHECK_INTERVAL_MS = 100;

// Test timeout (5 minutes)
export const TEST_TIMEOUT_MS = 300000;

// Job type ratios
export const RATIO_CRITICAL = 0.15;
export const RATIO_HIGH_PRI = 0.25;
export const RATIO_NORMAL = 0.3;
export const RATIO_LOW_PRI = 0.2;
export const RATIO_BACKGROUND = 0.1;

// Ratio thresholds for job type selection
const THRESHOLD_CRITICAL = 0.15;
const THRESHOLD_HIGH_PRI = 0.4;
const THRESHOLD_NORMAL = 0.7;
const THRESHOLD_LOW_PRI = 0.9;

// ============================================================================
// Types
// ============================================================================

export interface JobTypeMetrics {
  started: number;
  completed: number;
  failed: number;
  rejected: number;
}

export interface StressTestMetrics {
  jobsByType: Record<string, JobTypeMetrics>;
  invariantViolations: string[];
  peakInFlightByType: Record<string, number>;
  totalInFlightPeak: number;
  startTime: number;
  endTime: number;
}

export interface InvariantCheckResult {
  violations: string[];
  inFlightByType: Record<string, number>;
  totalInFlight: number;
}

// ============================================================================
// Job Type Configuration
// ============================================================================

export const JOB_TYPES_CONFIG = {
  critical: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_CRITICAL, flexible: false } },
  highPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_HIGH_PRI, flexible: true } },
  normal: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_NORMAL, flexible: true } },
  lowPri: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_LOW_PRI, flexible: true } },
  background: { estimatedUsedTokens: HUNDRED, ratio: { initialValue: RATIO_BACKGROUND, flexible: true } },
};

export const JOB_TYPE_NAMES = ['critical', 'highPri', 'normal', 'lowPri', 'background'] as const;
export type JobTypeName = (typeof JOB_TYPE_NAMES)[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Select a job type based on weighted probability matching the ratios.
 */
export const selectJobType = (): JobTypeName => {
  const rand = Math.random();
  if (rand < THRESHOLD_CRITICAL) return 'critical';
  if (rand < THRESHOLD_HIGH_PRI) return 'highPri';
  if (rand < THRESHOLD_NORMAL) return 'normal';
  if (rand < THRESHOLD_LOW_PRI) return 'lowPri';
  return 'background';
};

/**
 * Generate a random duration between MIN and MAX.
 */
export const randomDuration = (): number =>
  MIN_DURATION_MS + Math.random() * (MAX_DURATION_MS - MIN_DURATION_MS);

/**
 * Determine if a job should fail (5% chance).
 */
export const shouldFail = (): boolean => Math.random() < FAILURE_THRESHOLD;

/**
 * Create initial metrics structure.
 */
export const createMetrics = (): StressTestMetrics => {
  const jobsByType: Record<string, JobTypeMetrics> = {};
  const peakInFlightByType: Record<string, number> = {};

  for (const jobType of JOB_TYPE_NAMES) {
    jobsByType[jobType] = { started: ZERO, completed: ZERO, failed: ZERO, rejected: ZERO };
    peakInFlightByType[jobType] = ZERO;
  }

  return {
    jobsByType,
    invariantViolations: [],
    peakInFlightByType,
    totalInFlightPeak: ZERO,
    startTime: Date.now(),
    endTime: ZERO,
  };
};

/**
 * Check invariants for a backend.
 */
export const checkInvariants = async (backend: RedisBackendInstance): Promise<InvariantCheckResult> => {
  const violations: string[] = [];
  const inFlightByType: Record<string, number> = {};
  let totalInFlight = ZERO;

  const stats = await backend.getJobTypeStats();
  if (stats === undefined) {
    return { violations: ['Stats unavailable'], inFlightByType, totalInFlight };
  }

  for (const [jobType, typeStats] of Object.entries(stats.jobTypes)) {
    const { totalInFlight: inFlight, allocatedSlots } = typeStats;
    inFlightByType[jobType] = inFlight;
    totalInFlight += inFlight;

    if (inFlight > allocatedSlots) {
      violations.push(`[${jobType}] inFlight (${inFlight}) > allocatedSlots (${allocatedSlots})`);
    }

    if (inFlight < ZERO) {
      violations.push(`[${jobType}] inFlight (${inFlight}) is negative`);
    }
  }

  if (totalInFlight > CAPACITY) {
    violations.push(`totalInFlight (${totalInFlight}) > capacity (${CAPACITY})`);
  }

  return { violations, inFlightByType, totalInFlight };
};

/**
 * Increment a counter in the job type metrics.
 */
const incrementMetric = (
  typeMetrics: JobTypeMetrics,
  field: 'started' | 'completed' | 'failed' | 'rejected'
): void => {
  const { [field]: currentValue } = typeMetrics;
  Object.assign(typeMetrics, { [field]: currentValue + ONE });
};

/**
 * Run a single job with acquire/delay/release pattern.
 */
export const runJob = async (
  backend: RedisBackendInstance,
  instanceId: string,
  jobType: JobTypeName,
  metrics: StressTestMetrics
): Promise<void> => {
  const { jobsByType } = metrics;
  const { [jobType]: typeMetrics } = jobsByType;
  if (typeMetrics === undefined) return;

  const acquired = await backend.acquireJobType(instanceId, jobType);
  if (!acquired) {
    incrementMetric(typeMetrics, 'rejected');
    return;
  }

  incrementMetric(typeMetrics, 'started');

  try {
    const duration = randomDuration();
    await delay(duration);

    if (shouldFail()) {
      incrementMetric(typeMetrics, 'failed');
      throw new Error('Simulated job failure');
    }

    incrementMetric(typeMetrics, 'completed');
  } catch {
    // Error already tracked in metrics
  } finally {
    await backend.releaseJobType(instanceId, jobType);
  }
};

/**
 * Update peak tracking for a single job type.
 */
const updateSinglePeak = (
  peakByType: Record<string, number>,
  jobType: string,
  currentInFlight: number
): void => {
  const currentPeak = peakByType[jobType] ?? ZERO;
  if (currentInFlight > currentPeak) {
    Object.assign(peakByType, { [jobType]: currentInFlight });
  }
};

/**
 * Update peak tracking for metrics.
 */
export const updatePeakTracking = (metrics: StressTestMetrics, result: InvariantCheckResult): void => {
  const { peakInFlightByType } = metrics;
  let currentTotal = ZERO;

  for (const [jobType, inFlight] of Object.entries(result.inFlightByType)) {
    updateSinglePeak(peakInFlightByType, jobType, inFlight);
    currentTotal += inFlight;
  }

  if (currentTotal > metrics.totalInFlightPeak) {
    Object.assign(metrics, { totalInFlightPeak: currentTotal });
  }
};

/**
 * Record violations from invariant check.
 */
export const recordViolations = (metrics: StressTestMetrics, violations: string[]): void => {
  const { invariantViolations } = metrics;
  for (const violation of violations) {
    invariantViolations.push(violation);
  }
};
