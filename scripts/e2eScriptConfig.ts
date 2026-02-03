/**
 * E2E Script Configuration
 * Shared configuration constants for e2e scripts (job generator, prediction engine)
 */

/** Output directory for generated files (relative to scripts folder) */
export const OUTPUT_DIR = '../packages/redis/src/__tests__/e2e/fixtures';

/** Generate timestamp in YYYYMMDDHHmmss format */
export const generateTimestamp = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

/** Get input filename with timestamp */
export const getInputFilename = (timestamp: string): string => `test-input-${timestamp}.json`;

/** Get output filename with timestamp */
export const getOutputFilename = (timestamp: string): string => `test-output-${timestamp}.json`;

/** Number of distributed instances to create */
export const NUM_INSTANCES = 5;

/** Total number of jobs to generate */
export const TOTAL_JOBS = 15000;

/** Job duration range in milliseconds */
export const MIN_JOB_DURATION_MS = 5000;
export const MAX_JOB_DURATION_MS = 30000;

/** Job failure rate (5%) */
export const JOB_FAILURE_RATE = 0.05;

/** Job type names */
export const JOB_TYPES = [
  'Summary',
  'VacationPlanning',
  'ImageCreation',
  'BudgetCalculation',
  'WeatherForecast',
] as const;

export type JobTypeName = (typeof JOB_TYPES)[number];

/** Job type configuration */
export interface JobTypeConfig {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  ratio?: { initialValue: number; flexible: boolean };
}

/** Job types with their resource estimates and ratios */
export const JOB_TYPE_CONFIG: Record<JobTypeName, JobTypeConfig> = {
  Summary: {
    estimatedUsedTokens: 10000,
    estimatedNumberOfRequests: 1,
    ratio: { initialValue: 0.3, flexible: true },
  },
  VacationPlanning: {
    estimatedUsedTokens: 2000,
    estimatedNumberOfRequests: 3,
    ratio: { initialValue: 0.4, flexible: false },
  },
  ImageCreation: {
    estimatedUsedTokens: 5000,
    estimatedNumberOfRequests: 1,
    ratio: { initialValue: 0.1, flexible: true },
  },
  BudgetCalculation: {
    estimatedUsedTokens: 3000,
    estimatedNumberOfRequests: 5,
    ratio: { initialValue: 0.1, flexible: true },
  },
  WeatherForecast: {
    estimatedUsedTokens: 1000,
    estimatedNumberOfRequests: 1,
    ratio: { initialValue: 0.1, flexible: true },
  },
};

/** Model names */
export const MODEL_NAMES = ['ModelA', 'ModelB', 'ModelC'] as const;

export type ModelName = (typeof MODEL_NAMES)[number];

/** Model configuration */
export interface ModelConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  pricing: { input: number; cached: number; output: number };
}

/** Models with their rate limits */
export const MODEL_CONFIG: Record<ModelName, ModelConfig> = {
  ModelA: {
    requestsPerMinute: 500,
    tokensPerMinute: 1000000,
    pricing: { input: 0.01, cached: 0.005, output: 0.02 },
  },
  ModelB: {
    requestsPerMinute: 500,
    tokensPerMinute: 1000000,
    pricing: { input: 0.01, cached: 0.005, output: 0.02 },
  },
  ModelC: {
    requestsPerMinute: 100,
    tokensPerMinute: 500000,
    pricing: { input: 0.005, cached: 0.0025, output: 0.01 },
  },
};

/** Model fallback order */
export const MODEL_ORDER: readonly ModelName[] = ['ModelA', 'ModelB', 'ModelC'];

/** Total capacity across all models */
export const TOTAL_REQUESTS_PER_MINUTE = 500 + 500 + 100; // 1100
export const TOTAL_TOKENS_PER_MINUTE = 1000000 + 1000000 + 500000; // 2,500,000

/** Traffic pattern segments */
export interface TrafficSegment {
  startMs: number;
  endMs: number;
  ratePerSec: number;
  type: 'spike' | 'steady' | 'valley';
}

/**
 * Traffic pattern design:
 * - 0-30s: Spike (50 jobs/sec) = 1500 jobs
 * - 30-60s: Steady (20 jobs/sec) = 600 jobs
 * - 60-90s: Valley (5 jobs/sec) = 150 jobs
 * - 90-150s: Spike (60 jobs/sec) = 3600 jobs
 * - 150-200s: Steady (30 jobs/sec) = 1500 jobs
 * - 200-250s: Valley (10 jobs/sec) = 500 jobs
 * - 250-300s: Final spike (40 jobs/sec) = 2000 jobs
 * - 300-450s: Extended steady (35 jobs/sec) = 5250 jobs
 * Total: ~15100 jobs (we'll trim to exactly 15000)
 */
export const TRAFFIC_PATTERN: TrafficSegment[] = [
  { startMs: 0, endMs: 30000, ratePerSec: 50, type: 'spike' },
  { startMs: 30000, endMs: 60000, ratePerSec: 20, type: 'steady' },
  { startMs: 60000, endMs: 90000, ratePerSec: 5, type: 'valley' },
  { startMs: 90000, endMs: 150000, ratePerSec: 60, type: 'spike' },
  { startMs: 150000, endMs: 200000, ratePerSec: 30, type: 'steady' },
  { startMs: 200000, endMs: 250000, ratePerSec: 10, type: 'valley' },
  { startMs: 250000, endMs: 300000, ratePerSec: 40, type: 'spike' },
  { startMs: 300000, endMs: 450000, ratePerSec: 35, type: 'steady' },
];

/** Ratio adjustment configuration */
export const RATIO_ADJUSTMENT_CONFIG = {
  highLoadThreshold: 0.8,
  lowLoadThreshold: 0.3,
  maxAdjustment: 0.1,
  minRatio: 0.05,
  adjustmentIntervalMs: 5000,
  releasesPerAdjustment: 10,
};

/** Time constants */
export const ONE_MINUTE_MS = 60000;
export const ONE_SECOND_MS = 1000;

/** Numeric constants */
export const ZERO = 0;
export const ONE = 1;
export const HUNDRED_PERCENT = 100;
