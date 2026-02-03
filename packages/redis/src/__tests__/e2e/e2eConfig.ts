/**
 * E2E Test Configuration
 * Shared configuration constants for e2e tests
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

/** Redis connection URL for e2e tests - loaded from environment variable */
export const getRedisUrl = (): string => {
  const url = process.env['REDIS_URL'];
  if (url === undefined || url === '') {
    throw new Error('REDIS_URL environment variable is required for e2e tests');
  }
  return url;
};

/** Key prefix for e2e tests to isolate from other data */
export const E2E_KEY_PREFIX = 'e2e-test:';

/** Number of distributed instances to create */
export const NUM_INSTANCES = 5;

/** Job type names */
export const JOB_TYPES = [
  'Summary',
  'VacationPlanning',
  'ImageCreation',
  'BudgetCalculation',
  'WeatherForecast',
] as const;

export type JobTypeName = (typeof JOB_TYPES)[number];

/** Job type configuration for rate limiter */
export const RESOURCES_PER_JOB = {
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

/** Models configuration for rate limiter */
export const MODELS = {
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

/** Job data structure */
export interface JobData {
  id: string;
  jobType: JobTypeName;
  durationMs: number;
  scheduledAtMs: number;
  shouldFail: boolean;
}

/** Job data file structure */
export interface JobDataFile {
  generatedAt: string;
  totalJobs: number;
  testDurationMs: number;
  seed: number;
  jobs: JobData[];
  trafficPattern: {
    spikes: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
    valleys: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
    steady: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
  };
  jobTypeDistribution: Record<JobTypeName, number>;
}

/** Prediction summary */
export interface PredictionSummary {
  totalJobsProcessed: number;
  totalJobsFailed: number;
  totalRejections: number;
  modelUsage: Record<ModelName, { jobs: number; tokensUsed: number; requestsUsed: number }>;
  modelFallbacks: number;
  ratioChanges: Array<{ timeMs: number; jobType: JobTypeName; oldRatio: number; newRatio: number }>;
  minuteBoundaryResets: number;
  peakConcurrentJobs: number;
  averageQueueWaitMs: number;
}

/** Predictions file structure */
export interface PredictionsFile {
  generatedAt: string;
  jobDataFile: string;
  summary: PredictionSummary;
  finalRatios: Record<JobTypeName, number>;
  vacationPlanningRatioNeverChanged: boolean;
  timelineEventCounts: {
    job_queued: number;
    job_started: number;
    job_completed: number;
    job_failed: number;
    job_rejected: number;
    model_fallback: number;
    minute_reset: number;
    ratio_change: number;
  };
  fullTimelineLength: number;
}

/** Find the latest test files by timestamp */
const findLatestTestFiles = (): { inputFile: string; outputFile: string } => {
  const fixturesDir = path.join(currentDir, 'fixtures');
  const files = fs.readdirSync(fixturesDir);

  // Find all input files and get their timestamps
  const inputFiles = files.filter((f) => f.startsWith('test-input-') && f.endsWith('.json'));

  if (inputFiles.length === ZERO) {
    throw new Error('No test-input files found in fixtures directory');
  }

  // Sort by timestamp (descending) to get the latest
  inputFiles.sort().reverse();
  const latestInput = inputFiles[ZERO];
  if (latestInput === undefined) {
    throw new Error('No test-input files found in fixtures directory');
  }
  const timestamp = latestInput.replace('test-input-', '').replace('.json', '');
  const outputFile = `test-output-${timestamp}.json`;

  return {
    inputFile: path.join(fixturesDir, latestInput),
    outputFile: path.join(fixturesDir, outputFile),
  };
};

/** Load job data from fixtures (uses latest test-input file) */
export const loadJobData = (): JobDataFile => {
  const { inputFile } = findLatestTestFiles();
  const content = fs.readFileSync(inputFile, 'utf-8');
  return JSON.parse(content) as JobDataFile;
};

/** Load predictions from fixtures (uses latest test-output file) */
export const loadPredictions = (): PredictionsFile => {
  const { outputFile } = findLatestTestFiles();
  const content = fs.readFileSync(outputFile, 'utf-8');
  return JSON.parse(content) as PredictionsFile;
};
