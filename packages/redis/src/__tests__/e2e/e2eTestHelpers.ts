/**
 * E2E Test Helpers
 * Shared test utilities and setup for e2e tests
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';
import { setTimeout as sleep } from 'node:timers/promises';

import { createRedisBackend } from '../../redisBackendFactory.js';
import {
  E2E_KEY_PREFIX,
  type JobData,
  type JobDataFile,
  type JobTypeConfig,
  type JobTypeName,
  type ModelConfig,
  type ModelName,
  NUM_INSTANCES,
  ONE,
  type PredictionsFile,
  type RatioAdjustmentConfig,
  ZERO,
  getRedisUrl,
  loadJobData,
  loadPredictions,
} from './e2eConfig.js';

/** Test timeout constants */
export const TIMEOUT_SHORT = 10000;
export const TIMEOUT_MEDIUM = 30000;
export const TIMEOUT_LONG = 60000;

/** Job processing constants */
export const BATCH_SIZE = 10;
export const DURATION_DIVISOR = 10;
export const MAX_SCALED_DURATION = 3000;
export const INPUT_TOKEN_RATIO = 0.6;
export const OUTPUT_TOKEN_RATIO = 0.4;
export const TOTAL_JOBS_EXPECTED = 15000;

/** Ratio constants for verification */
export const VACATION_PLANNING_RATIO = 0.4;
export const SUMMARY_RATIO = 0.3;
export const OTHER_RATIO = 0.1;
export const RATIO_TOTAL = 1.0;
export const RATIO_PRECISION = 5;

/** Instance with its backend factory for proper cleanup */
export interface InstanceWithStats {
  limiter: LLMRateLimiterInstance<JobTypeName>;
  backend: ReturnType<typeof createRedisBackend>;
  instanceId: number;
}

/** Test results tracking */
export interface TestResults {
  jobsStarted: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsRejected: number;
  modelUsage: Record<string, number>;
  modelFallbacks: number;
  ratioChanges: Array<{ jobType: string; oldRatio: number; newRatio: number }>;
  peakConcurrentJobs: number;
  capacityExceededCount: number;
}

/** Create empty test results */
export const createEmptyResults = (): TestResults => ({
  jobsStarted: ZERO,
  jobsCompleted: ZERO,
  jobsFailed: ZERO,
  jobsRejected: ZERO,
  modelUsage: { ModelA: ZERO, ModelB: ZERO, ModelC: ZERO },
  modelFallbacks: ZERO,
  ratioChanges: [],
  peakConcurrentJobs: ZERO,
  capacityExceededCount: ZERO,
});

/** State container for e2e tests */
export interface E2ETestState {
  instances: InstanceWithStats[];
  jobData: JobDataFile | undefined;
  predictions: PredictionsFile | undefined;
  results: TestResults;
  models: Record<ModelName, ModelConfig> | undefined;
  modelOrder: readonly ModelName[] | undefined;
  jobTypesConfig: Record<JobTypeName, JobTypeConfig> | undefined;
  ratioAdjustmentConfig: RatioAdjustmentConfig | undefined;
  shouldSkip: boolean;
}

/** Create initial test state */
export const createTestState = (): E2ETestState => ({
  instances: [],
  jobData: undefined,
  predictions: undefined,
  results: createEmptyResults(),
  models: undefined,
  modelOrder: undefined,
  jobTypesConfig: undefined,
  ratioAdjustmentConfig: undefined,
  shouldSkip: process.env.REDIS_URL === undefined || process.env.REDIS_URL === '',
});

/** Load test data into state (returns updated state) */
/** Extract config from job data */
const extractConfig = (
  jobData: JobDataFile
): {
  models: Record<ModelName, ModelConfig>;
  modelOrder: readonly ModelName[];
  jobTypesConfig: Record<JobTypeName, JobTypeConfig>;
  ratioAdjustmentConfig: RatioAdjustmentConfig;
} => {
  const { config } = jobData;
  return {
    models: config.models,
    modelOrder: config.modelOrder,
    jobTypesConfig: config.jobTypes,
    ratioAdjustmentConfig: config.ratioAdjustment,
  };
};

export const loadTestData = (stateToUpdate: E2ETestState): E2ETestState => {
  if (stateToUpdate.shouldSkip) return stateToUpdate;

  const jobData = loadJobData();
  const predictions = loadPredictions();
  const configData = extractConfig(jobData);

  return {
    ...stateToUpdate,
    jobData,
    predictions,
    ...configData,
    results: createEmptyResults(),
  };
};

/** Create limiter instances and add to state */
export const createInstances = async (stateToUpdate: E2ETestState): Promise<E2ETestState> => {
  const { models, modelOrder, jobTypesConfig, ratioAdjustmentConfig, shouldSkip } = stateToUpdate;

  if (shouldSkip || models === undefined || jobTypesConfig === undefined) {
    return stateToUpdate;
  }

  const instances: InstanceWithStats[] = [];

  for (let i = ZERO; i < NUM_INSTANCES; i += ONE) {
    const backend = createRedisBackend({
      url: getRedisUrl(),
      keyPrefix: `${E2E_KEY_PREFIX}${Date.now()}:`,
    });
    const limiter = createLLMRateLimiter({
      models,
      escalationOrder: modelOrder,
      resourceEstimationsPerJob: jobTypesConfig,
      backend,
      ratioAdjustmentConfig,
    });

    // eslint-disable-next-line no-await-in-loop -- Sequential instance creation required
    await limiter.start();
    instances.push({ limiter, backend, instanceId: i });
  }

  return { ...stateToUpdate, instances };
};

/** Initialize test instances (combines loadTestData and createInstances) */
export const initializeInstances = async (stateToUpdate: E2ETestState): Promise<E2ETestState> => {
  const withData = loadTestData(stateToUpdate);
  return await createInstances(withData);
};

/** Cleanup test instances (returns updated state) */
export const cleanupInstances = async (stateToClean: E2ETestState): Promise<E2ETestState> => {
  for (const { limiter, backend } of stateToClean.instances) {
    limiter.stop();
    // eslint-disable-next-line no-await-in-loop -- Sequential cleanup required for proper connection closing
    await backend.stop();
  }
  return { ...stateToClean, instances: [] };
};

/** Get random instance from state */
export const getRandomInstance = (stateWithInstances: E2ETestState): InstanceWithStats => {
  const { instances } = stateWithInstances;
  if (instances.length === ZERO) {
    throw new Error('No instances available');
  }
  const index = Math.floor(Math.random() * instances.length);
  const selectedInstances = instances.slice(index, index + ONE);
  const [instance] = selectedInstances;
  if (instance === undefined) {
    throw new Error('No instances available');
  }
  return instance;
};

/** Job simulation result */
export interface SimulateJobResult {
  success: boolean;
  modelUsed?: string;
  rejected: boolean;
}

/** Get job type config by type */
const getJobTypeConfig = (
  jobTypesConfig: Record<JobTypeName, JobTypeConfig>,
  jobType: JobTypeName
): JobTypeConfig => jobTypesConfig[jobType];

/** Calculate token counts for a job */
const calculateTokens = (
  jobTypesConfig: Record<JobTypeName, JobTypeConfig>,
  jobType: JobTypeName
): { input: number; output: number; requests: number } => {
  const config = getJobTypeConfig(jobTypesConfig, jobType);
  return {
    input: Math.floor(config.estimatedUsedTokens * INPUT_TOKEN_RATIO),
    output: Math.floor(config.estimatedUsedTokens * OUTPUT_TOKEN_RATIO),
    requests: config.estimatedNumberOfRequests,
  };
};

/** Simulate a job execution */
export const simulateJob = async (
  job: JobData,
  instance: InstanceWithStats,
  jobTypesConfig: Record<JobTypeName, JobTypeConfig>
): Promise<SimulateJobResult> => {
  try {
    const result = await instance.limiter.queueJob({
      jobId: job.id,
      jobType: job.jobType,
      job: async (args, resolve) => {
        const scaledDuration = Math.min(job.durationMs / DURATION_DIVISOR, MAX_SCALED_DURATION);
        await sleep(scaledDuration);

        if (job.shouldFail) {
          throw new Error(`Job ${job.id} failed intentionally`);
        }

        const { input, output, requests } = calculateTokens(jobTypesConfig, job.jobType);

        resolve({
          modelId: args.modelId,
          inputTokens: input,
          cachedTokens: ZERO,
          outputTokens: output,
        });

        return {
          usage: { input, output, cached: ZERO },
          requestCount: requests,
        };
      },
    });

    return { success: true, modelUsed: result.modelUsed, rejected: false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isRejection = errorMessage.includes('rejected') || errorMessage.includes('capacity');
    return { success: false, rejected: isRejection };
  }
};
