/**
 * E2E Test Configuration
 * Shared configuration constants for e2e tests
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

/** Get Redis URL from environment */
const getEnvRedisUrl = (): string | undefined => process.env.REDIS_URL;

/** Redis connection URL for e2e tests - loaded from environment variable */
export const getRedisUrl = (): string => {
  const redisUrl = getEnvRedisUrl();
  if (redisUrl === undefined || redisUrl === '') {
    throw new Error('REDIS_URL environment variable is required for e2e tests');
  }
  return redisUrl;
};

/** Key prefix for e2e tests to isolate from other data */
export const E2E_KEY_PREFIX = 'e2e-test:';

/** Number of distributed instances to create */
export const NUM_INSTANCES = 5;

/** Job type names */
export type JobTypeName =
  | 'Summary'
  | 'VacationPlanning'
  | 'ImageCreation'
  | 'BudgetCalculation'
  | 'WeatherForecast';

/** Model names */
export type ModelName = 'ModelA' | 'ModelB' | 'ModelC';

/** Job type configuration structure */
export interface JobTypeConfig {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  ratio?: { initialValue: number; flexible: boolean };
}

/** Model configuration structure */
export interface ModelConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  pricing: { input: number; cached: number; output: number };
}

/** Ratio adjustment configuration structure */
export interface RatioAdjustmentConfig {
  highLoadThreshold: number;
  lowLoadThreshold: number;
  maxAdjustment: number;
  minRatio: number;
  adjustmentIntervalMs: number;
  releasesPerAdjustment: number;
}

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
  /** Configuration used for this test run */
  config: {
    models: Record<ModelName, ModelConfig>;
    modelOrder: readonly ModelName[];
    jobTypes: Record<JobTypeName, JobTypeConfig>;
    ratioAdjustment: RatioAdjustmentConfig;
  };
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

/** Type guard for JobDataFile */
const isJobDataFile = (data: unknown): data is JobDataFile =>
  typeof data === 'object' && data !== null && 'totalJobs' in data && 'jobs' in data && 'config' in data;

/** Type guard for PredictionsFile */
const isPredictionsFile = (data: unknown): data is PredictionsFile =>
  typeof data === 'object' && data !== null && 'summary' in data && 'finalRatios' in data;

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
  const [latestInput] = inputFiles;
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
  const parsed: unknown = JSON.parse(content);
  if (!isJobDataFile(parsed)) {
    throw new Error('Invalid job data file format');
  }
  return parsed;
};

/** Load predictions from fixtures (uses latest test-output file) */
export const loadPredictions = (): PredictionsFile => {
  const { outputFile } = findLatestTestFiles();
  const content = fs.readFileSync(outputFile, 'utf-8');
  const parsed: unknown = JSON.parse(content);
  if (!isPredictionsFile(parsed)) {
    throw new Error('Invalid predictions file format');
  }
  return parsed;
};

/** Load configuration from the job data file */
export const loadConfig = (): JobDataFile['config'] => {
  const jobData = loadJobData();
  return jobData.config;
};

/** Helper to get models config for rate limiter */
export const getModelsConfig = (): Record<ModelName, ModelConfig> => loadConfig().models;

/** Helper to get model order for rate limiter */
export const getModelOrder = (): readonly ModelName[] => loadConfig().modelOrder;

/** Helper to get job types config for rate limiter */
export const getJobTypesConfig = (): Record<JobTypeName, JobTypeConfig> => loadConfig().jobTypes;

/** Helper to get ratio adjustment config */
export const getRatioAdjustmentConfig = (): RatioAdjustmentConfig => loadConfig().ratioAdjustment;
