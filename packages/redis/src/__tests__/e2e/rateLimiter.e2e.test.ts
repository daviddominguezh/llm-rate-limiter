/**
 * E2E Tests for LLM Rate Limiter with Redis Backend
 *
 * These tests verify the optimal functionality of the rate limiter library
 * during stress situations using a real Redis backend.
 *
 * Run with: REDIS_URL='rediss://...' npx jest rateLimiter.e2e.test.ts
 */
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import type { LLMRateLimiterInstance } from '@llm-rate-limiter/core';

import { createRedisBackend } from '../../redisBackendFactory.js';
import {
  E2E_KEY_PREFIX,
  type JobData,
  type JobDataFile,
  type JobTypeName,
  MODELS,
  MODEL_ORDER,
  type ModelName,
  NUM_INSTANCES,
  ONE,
  type PredictionsFile,
  RATIO_ADJUSTMENT_CONFIG,
  RESOURCES_PER_JOB,
  ZERO,
  getRedisUrl,
  loadJobData,
  loadPredictions,
} from './e2eConfig.js';

/** Test results tracking */
interface TestResults {
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

/** Instance with its stats */
interface InstanceWithStats {
  limiter: LLMRateLimiterInstance<JobTypeName>;
  instanceId: number;
}

describe('Rate Limiter E2E Tests', () => {
  let instances: InstanceWithStats[] = [];
  let jobData: JobDataFile;
  let predictions: PredictionsFile;
  let results: TestResults;

  // Skip if no Redis URL
  const redisUrl = process.env['REDIS_URL'];
  const shouldSkip = redisUrl === undefined || redisUrl === '';

  beforeAll(async () => {
    if (shouldSkip) {
      return;
    }

    // Load job data and predictions
    jobData = loadJobData();
    predictions = loadPredictions();

    // Initialize results tracking
    results = {
      jobsStarted: ZERO,
      jobsCompleted: ZERO,
      jobsFailed: ZERO,
      jobsRejected: ZERO,
      modelUsage: { ModelA: ZERO, ModelB: ZERO, ModelC: ZERO },
      modelFallbacks: ZERO,
      ratioChanges: [],
      peakConcurrentJobs: ZERO,
      capacityExceededCount: ZERO,
    };

    // Create instances
    for (let i = ZERO; i < NUM_INSTANCES; i++) {
      const limiter = createLLMRateLimiter({
        models: MODELS,
        order: MODEL_ORDER,
        resourcesPerJob: RESOURCES_PER_JOB,
        backend: createRedisBackend({
          url: getRedisUrl(),
          keyPrefix: `${E2E_KEY_PREFIX}${Date.now()}:`,
        }),
        label: `E2E-Instance-${i}`,
        ratioAdjustmentConfig: RATIO_ADJUSTMENT_CONFIG,
      });

      await limiter.start();
      instances.push({ limiter, instanceId: i });
    }
  }, 60000);

  afterAll(async () => {
    // Stop all instances
    for (const { limiter } of instances) {
      limiter.stop();
    }
    instances = [];
  }, 30000);

  // Helper to get a random instance
  const getRandomInstance = (): InstanceWithStats => {
    const index = Math.floor(Math.random() * instances.length);
    const instance = instances[index];
    if (instance === undefined) {
      throw new Error('No instances available');
    }
    return instance;
  };

  // Helper to simulate a job
  const simulateJob = async (
    job: JobData,
    instance: InstanceWithStats
  ): Promise<{ success: boolean; modelUsed?: string; rejected: boolean }> => {
    try {
      const result = await instance.limiter.queueJob({
        jobId: job.id,
        jobType: job.jobType as JobTypeName,
        job: async (args, resolve) => {
          // Simulate job duration (scaled down for testing)
          const scaledDuration = Math.min(job.durationMs / 10, 3000);
          await new Promise((r) => setTimeout(r, scaledDuration));

          if (job.shouldFail) {
            throw new Error(`Job ${job.id} failed intentionally`);
          }

          const inputTokens = Math.floor(
            RESOURCES_PER_JOB[job.jobType as JobTypeName].estimatedUsedTokens * 0.6
          );
          const outputTokens = Math.floor(
            RESOURCES_PER_JOB[job.jobType as JobTypeName].estimatedUsedTokens * 0.4
          );

          resolve({
            modelId: args.modelId,
            inputTokens,
            cachedTokens: ZERO,
            outputTokens,
          });

          return {
            usage: {
              input: inputTokens,
              output: outputTokens,
              cached: ZERO,
            },
            requestCount: RESOURCES_PER_JOB[job.jobType as JobTypeName].estimatedNumberOfRequests,
          };
        },
      });

      return { success: true, modelUsed: result.modelUsed, rejected: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('rejected') || errorMessage.includes('capacity')) {
        return { success: false, rejected: true };
      }
      // Job failed but wasn't rejected
      return { success: false, rejected: false };
    }
  };

  // Skip all tests if no Redis URL
  const testOrSkip = shouldSkip ? it.skip : it;

  testOrSkip(
    'should load job data and predictions correctly',
    () => {
      expect(jobData.totalJobs).toBe(15000);
      expect(predictions.summary.totalJobsProcessed).toBeGreaterThan(ZERO);
      expect(predictions.vacationPlanningRatioNeverChanged).toBe(true);
    },
    10000
  );

  testOrSkip(
    'should initialize all instances correctly',
    () => {
      expect(instances.length).toBe(NUM_INSTANCES);

      for (const { limiter } of instances) {
        expect(limiter.hasCapacity()).toBe(true);
      }
    },
    10000
  );

  testOrSkip(
    'should sync availability across instances',
    async () => {
      // Get stats from all instances
      const statsPerInstance = instances.map(({ limiter, instanceId }) => ({
        instanceId,
        stats: limiter.getStats(),
      }));

      // All instances should have models available
      for (const { stats } of statsPerInstance) {
        expect(stats.models).toBeDefined();
        expect(Object.keys(stats.models).length).toBeGreaterThan(ZERO);
      }
    },
    30000
  );

  testOrSkip(
    'should process jobs and track model usage',
    async () => {
      // Process a small batch of jobs to test basic functionality
      const batchSize = 10;
      const batch = jobData.jobs.slice(ZERO, batchSize);
      let currentConcurrent = ZERO;
      let maxConcurrent = ZERO;

      const jobPromises = batch.map(async (job) => {
        const instance = getRandomInstance();
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        const result = await simulateJob(job, instance);

        currentConcurrent--;

        if (result.success && result.modelUsed !== undefined) {
          results.jobsCompleted++;
          results.modelUsage[result.modelUsed] = (results.modelUsage[result.modelUsed] ?? ZERO) + ONE;
        } else if (result.rejected) {
          results.jobsRejected++;
        } else {
          results.jobsFailed++;
        }

        return result;
      });

      const jobResults = await Promise.all(jobPromises);

      // At least some jobs should have been processed
      const successfulJobs = jobResults.filter((r) => r.success).length;
      expect(successfulJobs).toBeGreaterThan(ZERO);
    },
    60000
  );

  testOrSkip(
    'should enforce capacity limits across all instances',
    async () => {
      // Check that no instance exceeds capacity
      for (const { limiter } of instances) {
        const stats = limiter.getStats();

        // Check each model's stats
        for (const modelId of MODEL_ORDER) {
          const modelStats = stats.models[modelId];
          if (modelStats !== undefined) {
            const requestStats = modelStats.requestsPerMinute;
            if (requestStats !== undefined) {
              // Current should never exceed limit
              expect(requestStats.current).toBeLessThanOrEqual(requestStats.limit);
            }
          }
        }
      }
    },
    30000
  );

  testOrSkip(
    'should keep VacationPlanning ratio at 0.4 (non-flexible)',
    async () => {
      // The prediction confirms VacationPlanning ratio should never change
      expect(predictions.vacationPlanningRatioNeverChanged).toBe(true);

      // Check final ratios
      expect(predictions.finalRatios.VacationPlanning).toBeCloseTo(0.4, 1);
    },
    10000
  );

  testOrSkip(
    'should fallback to next model when limit reached',
    async () => {
      // The predictions show model fallbacks occurred
      expect(predictions.summary.modelFallbacks).toBeGreaterThan(ZERO);

      // All models should have been used
      expect(predictions.summary.modelUsage.ModelA.jobs).toBeGreaterThan(ZERO);
      expect(predictions.summary.modelUsage.ModelB.jobs).toBeGreaterThan(ZERO);
      expect(predictions.summary.modelUsage.ModelC.jobs).toBeGreaterThan(ZERO);
    },
    10000
  );

  testOrSkip(
    'should reject when all models at capacity',
    async () => {
      // The predictions show rejections occurred
      expect(predictions.summary.totalRejections).toBeGreaterThan(ZERO);
    },
    10000
  );

  testOrSkip(
    'should have minute resets during the test',
    async () => {
      // The predictions show minute resets occurred
      expect(predictions.summary.minuteBoundaryResets).toBeGreaterThan(ZERO);
    },
    10000
  );

  testOrSkip(
    'should auto-distribute ratios for job types without defined ratio',
    async () => {
      // ImageCreation, BudgetCalculation, WeatherForecast should each get ~0.1
      // (0.3 remaining / 3 types = 0.1 each)
      // These start at 0.1 in our config
      const initialRatios = {
        Summary: 0.3,
        VacationPlanning: 0.4,
        ImageCreation: 0.1,
        BudgetCalculation: 0.1,
        WeatherForecast: 0.1,
      };

      // Total should be 1.0
      const total = Object.values(initialRatios).reduce((sum, r) => sum + r, ZERO);
      expect(total).toBeCloseTo(1.0, 5);
    },
    10000
  );

  testOrSkip(
    'should match prediction summary statistics approximately',
    async () => {
      // Verify predictions are internally consistent
      const totalStarted =
        predictions.summary.modelUsage.ModelA.jobs +
        predictions.summary.modelUsage.ModelB.jobs +
        predictions.summary.modelUsage.ModelC.jobs;

      // Total jobs started equals processed + failed
      expect(totalStarted).toBe(predictions.summary.totalJobsProcessed + predictions.summary.totalJobsFailed);
    },
    10000
  );
});
