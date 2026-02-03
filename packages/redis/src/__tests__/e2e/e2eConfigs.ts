/**
 * E2E Test Configurations
 * Model, job type, and rate limiter configurations for e2e tests
 */

/** Job type names */
export const JOB_TYPES = [
  'Summary',
  'VacationPlanning',
  'ImageCreation',
  'BudgetCalculation',
  'WeatherForecast',
] as const;

export type JobTypeName = (typeof JOB_TYPES)[number];

/** Model names */
export const MODEL_NAMES = ['ModelA', 'ModelB', 'ModelC'] as const;

export type ModelName = (typeof MODEL_NAMES)[number];

/** Job type configuration */
export interface JobTypeConfig {
  estimatedUsedTokens: number;
  estimatedNumberOfRequests: number;
  ratio?: { initialValue: number; flexible: boolean };
}

/** Model configuration */
export interface ModelConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  pricing: { input: number; cached: number; output: number };
}

// Token estimation constants
const SUMMARY_TOKENS = 10000;
const VACATION_PLANNING_TOKENS = 2000;
const IMAGE_CREATION_TOKENS = 5000;
const BUDGET_CALCULATION_TOKENS = 3000;
const WEATHER_FORECAST_TOKENS = 1000;

// Request estimation constants
const SINGLE_REQUEST = 1;
const VACATION_PLANNING_REQUESTS = 3;
const BUDGET_CALCULATION_REQUESTS = 5;

// Ratio constants
const SUMMARY_RATIO = 0.3;
const VACATION_PLANNING_RATIO = 0.4;
const OTHER_JOB_RATIO = 0.1;

// Model rate limit constants
const MODEL_A_RPM = 500;
const MODEL_B_RPM = 500;
const MODEL_C_RPM = 100;
const MODEL_A_TPM = 1000000;
const MODEL_B_TPM = 1000000;
const MODEL_C_TPM = 500000;

// Pricing constants
const STANDARD_INPUT_PRICE = 0.01;
const STANDARD_CACHED_PRICE = 0.005;
const STANDARD_OUTPUT_PRICE = 0.02;
const DISCOUNT_INPUT_PRICE = 0.005;
const DISCOUNT_CACHED_PRICE = 0.0025;
const DISCOUNT_OUTPUT_PRICE = 0.01;

// Ratio adjustment constants
const HIGH_LOAD_THRESHOLD = 0.8;
const LOW_LOAD_THRESHOLD = 0.3;
const MAX_ADJUSTMENT = 0.1;
const MIN_RATIO = 0.05;
const ADJUSTMENT_INTERVAL_MS = 5000;
const RELEASES_PER_ADJUSTMENT = 10;

// Instance constants
const DEFAULT_NUM_INSTANCES = 5;

/** Job types with their resource estimates and ratios */
export const JOB_TYPE_CONFIG: Record<JobTypeName, JobTypeConfig> = {
  Summary: {
    estimatedUsedTokens: SUMMARY_TOKENS,
    estimatedNumberOfRequests: SINGLE_REQUEST,
    ratio: { initialValue: SUMMARY_RATIO, flexible: true },
  },
  VacationPlanning: {
    estimatedUsedTokens: VACATION_PLANNING_TOKENS,
    estimatedNumberOfRequests: VACATION_PLANNING_REQUESTS,
    ratio: { initialValue: VACATION_PLANNING_RATIO, flexible: false },
  },
  ImageCreation: {
    estimatedUsedTokens: IMAGE_CREATION_TOKENS,
    estimatedNumberOfRequests: SINGLE_REQUEST,
    ratio: { initialValue: OTHER_JOB_RATIO, flexible: true },
  },
  BudgetCalculation: {
    estimatedUsedTokens: BUDGET_CALCULATION_TOKENS,
    estimatedNumberOfRequests: BUDGET_CALCULATION_REQUESTS,
    ratio: { initialValue: OTHER_JOB_RATIO, flexible: true },
  },
  WeatherForecast: {
    estimatedUsedTokens: WEATHER_FORECAST_TOKENS,
    estimatedNumberOfRequests: SINGLE_REQUEST,
    ratio: { initialValue: OTHER_JOB_RATIO, flexible: true },
  },
};

/** Models with their rate limits */
export const MODEL_CONFIG: Record<ModelName, ModelConfig> = {
  ModelA: {
    requestsPerMinute: MODEL_A_RPM,
    tokensPerMinute: MODEL_A_TPM,
    pricing: { input: STANDARD_INPUT_PRICE, cached: STANDARD_CACHED_PRICE, output: STANDARD_OUTPUT_PRICE },
  },
  ModelB: {
    requestsPerMinute: MODEL_B_RPM,
    tokensPerMinute: MODEL_B_TPM,
    pricing: { input: STANDARD_INPUT_PRICE, cached: STANDARD_CACHED_PRICE, output: STANDARD_OUTPUT_PRICE },
  },
  ModelC: {
    requestsPerMinute: MODEL_C_RPM,
    tokensPerMinute: MODEL_C_TPM,
    pricing: { input: DISCOUNT_INPUT_PRICE, cached: DISCOUNT_CACHED_PRICE, output: DISCOUNT_OUTPUT_PRICE },
  },
};

/** Model fallback order */
export const MODEL_ORDER: readonly ModelName[] = ['ModelA', 'ModelB', 'ModelC'];

/** Ratio adjustment configuration */
export const RATIO_ADJUSTMENT_CONFIG = {
  highLoadThreshold: HIGH_LOAD_THRESHOLD,
  lowLoadThreshold: LOW_LOAD_THRESHOLD,
  maxAdjustment: MAX_ADJUSTMENT,
  minRatio: MIN_RATIO,
  adjustmentIntervalMs: ADJUSTMENT_INTERVAL_MS,
  releasesPerAdjustment: RELEASES_PER_ADJUSTMENT,
};

/** Key prefix for e2e tests to isolate from other data */
export const E2E_KEY_PREFIX = 'e2e-test:';

/** Number of distributed instances to create */
export const NUM_INSTANCES = DEFAULT_NUM_INSTANCES;

/** Helper to extract REDIS_URL from env */
const extractRedisUrl = ({ REDIS_URL }: NodeJS.ProcessEnv): string | undefined => REDIS_URL;

/** Get Redis URL from environment */
export const getRedisUrl = (): string => {
  const redisUrl = extractRedisUrl(process.env);
  if (redisUrl === undefined || redisUrl === '') {
    throw new Error('REDIS_URL environment variable is required for e2e tests');
  }
  return redisUrl;
};
