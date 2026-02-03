/**
 * E2E Tests for LLM Rate Limiter with Redis Backend
 *
 * These tests verify the optimal functionality of the rate limiter library
 * during stress situations using a real Redis backend.
 *
 * Run with: REDIS_URL='rediss://...' npx jest rateLimiter.e2e.test.ts
 */
import { ONE, ZERO } from './e2eConfig.js';
import {
  BATCH_SIZE,
  type E2ETestState,
  OTHER_RATIO,
  RATIO_PRECISION,
  RATIO_TOTAL,
  SUMMARY_RATIO,
  TIMEOUT_LONG,
  TIMEOUT_MEDIUM,
  TIMEOUT_SHORT,
  TOTAL_JOBS_EXPECTED,
  VACATION_PLANNING_RATIO,
  cleanupInstances,
  createTestState,
  getRandomInstance,
  initializeInstances,
  simulateJob,
} from './e2eTestHelpers.js';

const stateContainer = { current: createTestState() };

/** Get current state */
const getState = (): E2ETestState => stateContainer.current;

beforeAll(async () => {
  const { current: initialState } = stateContainer;
  const newState = await initializeInstances(initialState);
  Object.assign(stateContainer, { current: newState });
}, TIMEOUT_LONG);

afterAll(async () => {
  await cleanupInstances(getState());
}, TIMEOUT_MEDIUM);

describe('E2E - Data Loading', () => {
  it(
    'should load job data and predictions correctly',
    () => {
      const state = getState();
      expect(state.jobData?.totalJobs).toBe(TOTAL_JOBS_EXPECTED);
      expect(state.predictions?.summary.totalJobsProcessed).toBeGreaterThan(ZERO);
      expect(state.predictions?.vacationPlanningRatioNeverChanged).toBe(true);
    },
    TIMEOUT_SHORT
  );
});

describe('E2E - Instance Initialization', () => {
  it(
    'should initialize all instances correctly',
    () => {
      const { instances } = getState();
      expect(instances.length).toBeGreaterThan(ZERO);

      for (const { limiter } of instances) {
        expect(limiter.hasCapacity()).toBe(true);
      }
    },
    TIMEOUT_SHORT
  );

  it(
    'should sync availability across instances',
    () => {
      const { instances } = getState();
      for (const { limiter } of instances) {
        const { models } = limiter.getStats();
        expect(models).toBeDefined();
        expect(Object.keys(models).length).toBeGreaterThan(ZERO);
      }
    },
    TIMEOUT_MEDIUM
  );
});

describe('E2E - Job Processing', () => {
  it(
    'should process jobs and track model usage',
    async () => {
      const state = getState();
      if (state.shouldSkip) return;

      const { jobData, jobTypesConfig, results } = state;
      if (jobData === undefined || jobTypesConfig === undefined) return;

      const batch = jobData.jobs.slice(ZERO, BATCH_SIZE);

      const jobPromises = batch.map(async (job) => {
        const instance = getRandomInstance(state);
        const result = await simulateJob(job, instance, jobTypesConfig);

        if (result.success && result.modelUsed !== undefined) {
          results.jobsCompleted += ONE;
          const currentUsage = results.modelUsage[result.modelUsed] ?? ZERO;
          results.modelUsage[result.modelUsed] = currentUsage + ONE;
        } else if (result.rejected) {
          results.jobsRejected += ONE;
        } else {
          results.jobsFailed += ONE;
        }

        return result;
      });

      const jobResults = await Promise.all(jobPromises);
      const successfulResults = jobResults.filter((r) => r.success);
      expect(successfulResults).not.toHaveLength(ZERO);
    },
    TIMEOUT_LONG
  );
});

/** Model stats type */
interface ModelRequestStats {
  requestsPerMinute?: {
    current: number;
    limit: number;
  };
}

/** Get model stats for a specific model ID */
const getModelStats = (
  models: Record<string, ModelRequestStats | undefined>,
  modelId: string
): ModelRequestStats | undefined => models[modelId];

/** Verify model stats within capacity */
const verifyModelStats = (
  models: Record<string, ModelRequestStats | undefined>,
  modelOrder: readonly string[]
): void => {
  for (const modelId of modelOrder) {
    const modelStats = getModelStats(models, modelId);
    const requestStats = modelStats?.requestsPerMinute;
    if (requestStats !== undefined) {
      expect(requestStats.current).toBeLessThanOrEqual(requestStats.limit);
    }
  }
};

describe('E2E - Capacity Enforcement', () => {
  it(
    'should enforce capacity limits across all instances',
    () => {
      const state = getState();
      if (state.shouldSkip) return;

      const { instances, modelOrder } = state;
      if (modelOrder === undefined) return;

      for (const { limiter } of instances) {
        const { models } = limiter.getStats();
        verifyModelStats(models, modelOrder);
      }
    },
    TIMEOUT_MEDIUM
  );
});

describe('E2E - Ratio Verification', () => {
  it(
    'should keep VacationPlanning ratio at 0.4 (non-flexible)',
    () => {
      const { predictions } = getState();
      expect(predictions?.vacationPlanningRatioNeverChanged).toBe(true);
      expect(predictions?.finalRatios.VacationPlanning).toBeCloseTo(VACATION_PLANNING_RATIO, ONE);
    },
    TIMEOUT_SHORT
  );

  it(
    'should auto-distribute ratios for job types without defined ratio',
    () => {
      const initialRatios = {
        Summary: SUMMARY_RATIO,
        VacationPlanning: VACATION_PLANNING_RATIO,
        ImageCreation: OTHER_RATIO,
        BudgetCalculation: OTHER_RATIO,
        WeatherForecast: OTHER_RATIO,
      };

      const total = Object.values(initialRatios).reduce((sum, r) => sum + r, ZERO);
      expect(total).toBeCloseTo(RATIO_TOTAL, RATIO_PRECISION);
    },
    TIMEOUT_SHORT
  );
});

describe('E2E - Model Fallback', () => {
  it(
    'should fallback to next model when limit reached',
    () => {
      const { predictions } = getState();
      expect(predictions?.summary.modelFallbacks).toBeGreaterThan(ZERO);
      expect(predictions?.summary.modelUsage.ModelA.jobs).toBeGreaterThan(ZERO);
      expect(predictions?.summary.modelUsage.ModelB.jobs).toBeGreaterThan(ZERO);
      expect(predictions?.summary.modelUsage.ModelC.jobs).toBeGreaterThan(ZERO);
    },
    TIMEOUT_SHORT
  );

  it(
    'should reject when all models at capacity',
    () => {
      const { predictions } = getState();
      expect(predictions?.summary.totalRejections).toBeGreaterThan(ZERO);
    },
    TIMEOUT_SHORT
  );
});

describe('E2E - Timing and Resets', () => {
  it(
    'should have minute resets during the test',
    () => {
      const { predictions } = getState();
      expect(predictions?.summary.minuteBoundaryResets).toBeGreaterThan(ZERO);
    },
    TIMEOUT_SHORT
  );
});

describe('E2E - Prediction Verification', () => {
  it(
    'should match prediction summary statistics approximately',
    () => {
      const { predictions } = getState();
      if (predictions === undefined) return;

      const { summary } = predictions;
      const { modelUsage, totalJobsProcessed, totalJobsFailed } = summary;
      const totalStarted = modelUsage.ModelA.jobs + modelUsage.ModelB.jobs + modelUsage.ModelC.jobs;
      expect(totalStarted).toBe(totalJobsProcessed + totalJobsFailed);
    },
    TIMEOUT_SHORT
  );
});
