/**
 * Prediction Engine for E2E Tests
 *
 * Simulates the rate limiter behavior and predicts what should happen
 * given the job data and configuration. Outputs predictions to a JSON file.
 *
 * Run with: npx tsx scripts/predictionEngine.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  JOB_TYPE_CONFIG,
  type JobTypeName,
  MODEL_CONFIG,
  MODEL_ORDER,
  type ModelName,
  NUM_INSTANCES,
  ONE,
  ONE_MINUTE_MS,
  ONE_SECOND_MS,
  OUTPUT_DIR,
  RATIO_ADJUSTMENT_CONFIG,
  ZERO,
  getOutputFilename,
} from './e2eScriptConfig.js';
import type { JobData, JobDataFile } from './generateJobData.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

/** Timeline event types */
export type TimelineEventType =
  | 'job_queued'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'job_rejected'
  | 'model_fallback'
  | 'model_exhausted'
  | 'minute_reset'
  | 'ratio_change'
  | 'capacity_full';

/** Timeline event */
export interface TimelineEvent {
  timeMs: number;
  type: TimelineEventType;
  details: {
    jobId?: string;
    jobType?: JobTypeName;
    modelId?: ModelName;
    fromModel?: ModelName;
    toModel?: ModelName;
    reason?: string;
    oldRatio?: number;
    newRatio?: number;
    minuteNumber?: number;
    tokensUsed?: number;
    requestsUsed?: number;
  };
}

/** Model usage tracking per minute */
export interface ModelMinuteUsage {
  tokensUsed: number;
  requestsUsed: number;
  jobsStarted: number;
}

/** Job type ratio tracking */
export interface RatioState {
  currentRatio: number;
  isFlexible: boolean;
  inFlightJobs: number;
  totalSlots: number;
}

/** Active job tracking */
export interface ActiveJob {
  job: JobData;
  startTimeMs: number;
  endTimeMs: number;
  modelId: ModelName;
  instanceId: number;
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

/** Complete prediction result */
export interface PredictionResult {
  generatedAt: string;
  jobDataFile: string;
  timeline: TimelineEvent[];
  summary: PredictionSummary;
  finalRatios: Record<JobTypeName, number>;
  vacationPlanningRatioNeverChanged: boolean;
}

/** Internal state for the simulation */
interface SimulationState {
  currentTimeMs: number;
  currentMinute: number;
  modelUsagePerMinute: Map<number, Record<ModelName, ModelMinuteUsage>>;
  activeJobs: ActiveJob[];
  pendingJobs: JobData[];
  completedJobs: string[];
  failedJobs: string[];
  rejectedJobs: string[];
  ratios: Record<JobTypeName, RatioState>;
  timeline: TimelineEvent[];
  totalFallbacks: number;
  totalMinuteResets: number;
  queueWaitTimes: number[];
}

/** Calculate total capacity for job type slots */
const calculateTotalSlots = (): number => {
  let totalRequests = ZERO;
  for (const modelName of MODEL_ORDER) {
    totalRequests += MODEL_CONFIG[modelName].requestsPerMinute;
  }
  return totalRequests;
};

/** Initialize ratio state for all job types */
const initializeRatios = (): Record<JobTypeName, RatioState> => {
  const totalSlots = calculateTotalSlots();
  const ratios: Record<string, RatioState> = {};

  for (const [jobType, config] of Object.entries(JOB_TYPE_CONFIG)) {
    const initialRatio = config.ratio?.initialValue ?? 0.1;
    ratios[jobType] = {
      currentRatio: initialRatio,
      isFlexible: config.ratio?.flexible ?? true,
      inFlightJobs: ZERO,
      totalSlots: Math.floor(totalSlots * initialRatio),
    };
  }

  return ratios as Record<JobTypeName, RatioState>;
};

/** Get or initialize model usage for a minute */
const getModelUsageForMinute = (
  state: SimulationState,
  minute: number
): Record<ModelName, ModelMinuteUsage> => {
  let usage = state.modelUsagePerMinute.get(minute);
  if (usage === undefined) {
    usage = {
      ModelA: { tokensUsed: ZERO, requestsUsed: ZERO, jobsStarted: ZERO },
      ModelB: { tokensUsed: ZERO, requestsUsed: ZERO, jobsStarted: ZERO },
      ModelC: { tokensUsed: ZERO, requestsUsed: ZERO, jobsStarted: ZERO },
    };
    state.modelUsagePerMinute.set(minute, usage);
  }
  return usage;
};

/** Check if a model has capacity for the given job type */
const modelHasCapacity = (state: SimulationState, modelId: ModelName, jobType: JobTypeName): boolean => {
  const minute = Math.floor(state.currentTimeMs / ONE_MINUTE_MS);
  const usage = getModelUsageForMinute(state, minute);
  const modelConfig = MODEL_CONFIG[modelId];
  const jobConfig = JOB_TYPE_CONFIG[jobType];

  const tokensNeeded = jobConfig.estimatedUsedTokens;
  const requestsNeeded = jobConfig.estimatedNumberOfRequests;

  const hasTokenCapacity = usage[modelId].tokensUsed + tokensNeeded <= modelConfig.tokensPerMinute;
  const hasRequestCapacity = usage[modelId].requestsUsed + requestsNeeded <= modelConfig.requestsPerMinute;

  return hasTokenCapacity && hasRequestCapacity;
};

/** Check if job type has capacity (ratio-based slots) */
const jobTypeHasCapacity = (state: SimulationState, jobType: JobTypeName): boolean => {
  const ratioState = state.ratios[jobType];
  return ratioState.inFlightJobs < ratioState.totalSlots;
};

/** Find an available model for a job, returns null if all exhausted */
const findAvailableModel = (
  state: SimulationState,
  jobType: JobTypeName,
  excludeModels: Set<ModelName> = new Set()
): ModelName | null => {
  for (const modelId of MODEL_ORDER) {
    if (excludeModels.has(modelId)) {
      continue;
    }
    if (modelHasCapacity(state, modelId, jobType)) {
      return modelId;
    }
  }
  return null;
};

/** Consume model capacity for a job */
const consumeModelCapacity = (state: SimulationState, modelId: ModelName, jobType: JobTypeName): void => {
  const minute = Math.floor(state.currentTimeMs / ONE_MINUTE_MS);
  const usage = getModelUsageForMinute(state, minute);
  const jobConfig = JOB_TYPE_CONFIG[jobType];

  usage[modelId].tokensUsed += jobConfig.estimatedUsedTokens;
  usage[modelId].requestsUsed += jobConfig.estimatedNumberOfRequests;
  usage[modelId].jobsStarted++;
};

/** Start a job on a model */
const startJob = (state: SimulationState, job: JobData, modelId: ModelName, instanceId: number): void => {
  const activeJob: ActiveJob = {
    job,
    startTimeMs: state.currentTimeMs,
    endTimeMs: state.currentTimeMs + job.durationMs,
    modelId,
    instanceId,
  };

  state.activeJobs.push(activeJob);
  state.ratios[job.jobType].inFlightJobs++;
  consumeModelCapacity(state, modelId, job.jobType);

  state.timeline.push({
    timeMs: state.currentTimeMs,
    type: 'job_started',
    details: {
      jobId: job.id,
      jobType: job.jobType,
      modelId,
    },
  });
};

/** Complete active jobs that have finished */
const completeFinishedJobs = (state: SimulationState): void => {
  const stillActive: ActiveJob[] = [];

  for (const activeJob of state.activeJobs) {
    if (activeJob.endTimeMs <= state.currentTimeMs) {
      state.ratios[activeJob.job.jobType].inFlightJobs--;

      if (activeJob.job.shouldFail) {
        state.failedJobs.push(activeJob.job.id);
        state.timeline.push({
          timeMs: activeJob.endTimeMs,
          type: 'job_failed',
          details: {
            jobId: activeJob.job.id,
            jobType: activeJob.job.jobType,
            modelId: activeJob.modelId,
          },
        });
      } else {
        state.completedJobs.push(activeJob.job.id);
        state.timeline.push({
          timeMs: activeJob.endTimeMs,
          type: 'job_completed',
          details: {
            jobId: activeJob.job.id,
            jobType: activeJob.job.jobType,
            modelId: activeJob.modelId,
          },
        });
      }
    } else {
      stillActive.push(activeJob);
    }
  }

  state.activeJobs = stillActive;
};

/** Handle minute boundary reset */
const checkMinuteReset = (state: SimulationState): void => {
  const newMinute = Math.floor(state.currentTimeMs / ONE_MINUTE_MS);

  if (newMinute > state.currentMinute) {
    state.currentMinute = newMinute;
    state.totalMinuteResets++;

    state.timeline.push({
      timeMs: state.currentTimeMs,
      type: 'minute_reset',
      details: {
        minuteNumber: newMinute,
      },
    });
  }
};

/** Try to process a single pending job */
const tryProcessJob = (state: SimulationState, job: JobData): boolean => {
  // Check job type capacity first
  if (!jobTypeHasCapacity(state, job.jobType)) {
    return false;
  }

  // Find an available model with fallback tracking
  let modelId: ModelName | null = null;
  let fallbackOccurred = false;
  let firstModelTried: ModelName | null = null;

  for (const candidateModel of MODEL_ORDER) {
    if (modelHasCapacity(state, candidateModel, job.jobType)) {
      modelId = candidateModel;
      if (firstModelTried !== null && firstModelTried !== modelId) {
        fallbackOccurred = true;
        state.totalFallbacks++;
        state.timeline.push({
          timeMs: state.currentTimeMs,
          type: 'model_fallback',
          details: {
            jobId: job.id,
            jobType: job.jobType,
            fromModel: firstModelTried,
            toModel: modelId,
          },
        });
      }
      break;
    }
    if (firstModelTried === null) {
      firstModelTried = candidateModel;
    }
  }

  if (modelId === null) {
    // All models exhausted - reject
    return false;
  }

  // Assign to a random instance (for simulation purposes, just use round-robin)
  const instanceId = state.completedJobs.length % NUM_INSTANCES;

  // Start the job
  startJob(state, job, modelId, instanceId);
  return true;
};

/** Process pending jobs */
const processPendingJobs = (state: SimulationState): void => {
  const stillPending: JobData[] = [];

  for (const job of state.pendingJobs) {
    const processed = tryProcessJob(state, job);
    if (!processed) {
      // Check if we should reject (all models at capacity)
      const anyModelAvailable = MODEL_ORDER.some((modelId) => modelHasCapacity(state, modelId, job.jobType));

      if (!anyModelAvailable) {
        state.rejectedJobs.push(job.id);
        state.timeline.push({
          timeMs: state.currentTimeMs,
          type: 'job_rejected',
          details: {
            jobId: job.id,
            jobType: job.jobType,
            reason: 'all_models_exhausted',
          },
        });
      } else {
        // Job type at capacity, keep pending
        stillPending.push(job);
      }
    }
  }

  state.pendingJobs = stillPending;
};

/** Queue new jobs that are scheduled for the current time */
const queueScheduledJobs = (state: SimulationState, allJobs: JobData[]): void => {
  for (const job of allJobs) {
    if (
      job.scheduledAtMs <= state.currentTimeMs &&
      !state.completedJobs.includes(job.id) &&
      !state.failedJobs.includes(job.id) &&
      !state.rejectedJobs.includes(job.id) &&
      !state.pendingJobs.some((p) => p.id === job.id) &&
      !state.activeJobs.some((a) => a.job.id === job.id)
    ) {
      state.pendingJobs.push(job);
      state.timeline.push({
        timeMs: state.currentTimeMs,
        type: 'job_queued',
        details: {
          jobId: job.id,
          jobType: job.jobType,
        },
      });
    }
  }
};

/** Simulate ratio adjustment (simplified) */
const simulateRatioAdjustment = (state: SimulationState): void => {
  const adjustmentInterval = RATIO_ADJUSTMENT_CONFIG.adjustmentIntervalMs;

  // Only check at adjustment intervals
  if (state.currentTimeMs % adjustmentInterval !== ZERO) {
    return;
  }

  const totalSlots = calculateTotalSlots();

  for (const [jobType, ratioState] of Object.entries(state.ratios)) {
    if (!ratioState.isFlexible) {
      // Non-flexible ratios don't change
      continue;
    }

    const utilization = ratioState.inFlightJobs / Math.max(ONE, ratioState.totalSlots);

    if (utilization > RATIO_ADJUSTMENT_CONFIG.highLoadThreshold) {
      // High load - try to increase ratio
      const newRatio = Math.min(ONE, ratioState.currentRatio + RATIO_ADJUSTMENT_CONFIG.maxAdjustment);
      if (newRatio !== ratioState.currentRatio) {
        const oldRatio = ratioState.currentRatio;
        ratioState.currentRatio = newRatio;
        ratioState.totalSlots = Math.floor(totalSlots * newRatio);

        state.timeline.push({
          timeMs: state.currentTimeMs,
          type: 'ratio_change',
          details: {
            jobType: jobType as JobTypeName,
            oldRatio,
            newRatio,
            reason: 'high_load',
          },
        });
      }
    } else if (utilization < RATIO_ADJUSTMENT_CONFIG.lowLoadThreshold) {
      // Low load - try to decrease ratio
      const newRatio = Math.max(
        RATIO_ADJUSTMENT_CONFIG.minRatio,
        ratioState.currentRatio - RATIO_ADJUSTMENT_CONFIG.maxAdjustment
      );
      if (newRatio !== ratioState.currentRatio) {
        const oldRatio = ratioState.currentRatio;
        ratioState.currentRatio = newRatio;
        ratioState.totalSlots = Math.floor(totalSlots * newRatio);

        state.timeline.push({
          timeMs: state.currentTimeMs,
          type: 'ratio_change',
          details: {
            jobType: jobType as JobTypeName,
            oldRatio,
            newRatio,
            reason: 'low_load',
          },
        });
      }
    }
  }
};

/** Build prediction summary from state */
const buildSummary = (state: SimulationState): PredictionSummary => {
  const modelUsage: Record<ModelName, { jobs: number; tokensUsed: number; requestsUsed: number }> = {
    ModelA: { jobs: ZERO, tokensUsed: ZERO, requestsUsed: ZERO },
    ModelB: { jobs: ZERO, tokensUsed: ZERO, requestsUsed: ZERO },
    ModelC: { jobs: ZERO, tokensUsed: ZERO, requestsUsed: ZERO },
  };

  // Aggregate model usage across all minutes
  for (const minuteUsage of state.modelUsagePerMinute.values()) {
    for (const modelId of MODEL_ORDER) {
      modelUsage[modelId].jobs += minuteUsage[modelId].jobsStarted;
      modelUsage[modelId].tokensUsed += minuteUsage[modelId].tokensUsed;
      modelUsage[modelId].requestsUsed += minuteUsage[modelId].requestsUsed;
    }
  }

  // Extract ratio changes from timeline
  const ratioChanges: Array<{
    timeMs: number;
    jobType: JobTypeName;
    oldRatio: number;
    newRatio: number;
  }> = [];
  for (const event of state.timeline) {
    if (event.type === 'ratio_change' && event.details.jobType !== undefined) {
      ratioChanges.push({
        timeMs: event.timeMs,
        jobType: event.details.jobType,
        oldRatio: event.details.oldRatio ?? ZERO,
        newRatio: event.details.newRatio ?? ZERO,
      });
    }
  }

  // Calculate peak concurrent jobs
  let peakConcurrent = ZERO;
  let currentConcurrent = ZERO;
  for (const event of state.timeline) {
    if (event.type === 'job_started') {
      currentConcurrent++;
      peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
    } else if (event.type === 'job_completed' || event.type === 'job_failed') {
      currentConcurrent = Math.max(ZERO, currentConcurrent - ONE);
    }
  }

  return {
    totalJobsProcessed: state.completedJobs.length,
    totalJobsFailed: state.failedJobs.length,
    totalRejections: state.rejectedJobs.length,
    modelUsage,
    modelFallbacks: state.totalFallbacks,
    ratioChanges,
    minuteBoundaryResets: state.totalMinuteResets,
    peakConcurrentJobs: peakConcurrent,
    averageQueueWaitMs:
      state.queueWaitTimes.length > ZERO
        ? state.queueWaitTimes.reduce((a, b) => a + b, ZERO) / state.queueWaitTimes.length
        : ZERO,
  };
};

/** Build final ratios from state */
const buildFinalRatios = (state: SimulationState): Record<JobTypeName, number> => {
  const finalRatios: Record<string, number> = {};
  for (const [jobType, ratioState] of Object.entries(state.ratios)) {
    finalRatios[jobType] = ratioState.currentRatio;
  }
  return finalRatios as Record<JobTypeName, number>;
};

/** Check if VacationPlanning ratio never changed */
const checkVacationPlanningRatioUnchanged = (timeline: TimelineEvent[]): boolean => {
  for (const event of timeline) {
    if (event.type === 'ratio_change' && event.details.jobType === 'VacationPlanning') {
      return false;
    }
  }
  return true;
};

/**
 * Run the prediction simulation
 */
const predictResults = (jobData: JobDataFile): PredictionResult => {
  const state: SimulationState = {
    currentTimeMs: ZERO,
    currentMinute: ZERO,
    modelUsagePerMinute: new Map(),
    activeJobs: [],
    pendingJobs: [],
    completedJobs: [],
    failedJobs: [],
    rejectedJobs: [],
    ratios: initializeRatios(),
    timeline: [],
    totalFallbacks: ZERO,
    totalMinuteResets: ZERO,
    queueWaitTimes: [],
  };

  const timeStep = 100; // 100ms time steps for simulation
  const maxTime = jobData.testDurationMs;

  while (state.currentTimeMs <= maxTime) {
    // Check for minute boundary reset
    checkMinuteReset(state);

    // Complete finished jobs
    completeFinishedJobs(state);

    // Queue newly scheduled jobs
    queueScheduledJobs(state, jobData.jobs);

    // Process pending jobs
    processPendingJobs(state);

    // Simulate ratio adjustment
    simulateRatioAdjustment(state);

    // Advance time
    state.currentTimeMs += timeStep;

    // Early exit if all jobs are processed
    const totalProcessed = state.completedJobs.length + state.failedJobs.length + state.rejectedJobs.length;
    if (totalProcessed >= jobData.totalJobs && state.activeJobs.length === ZERO) {
      break;
    }
  }

  // Sort timeline by time
  state.timeline.sort((a, b) => a.timeMs - b.timeMs);

  return {
    generatedAt: new Date().toISOString(),
    jobDataFile: '',
    timeline: state.timeline,
    summary: buildSummary(state),
    finalRatios: buildFinalRatios(state),
    vacationPlanningRatioNeverChanged: checkVacationPlanningRatioUnchanged(state.timeline),
  };
};

/** Extract timestamp from input filename (test-input-YYYYMMDDHHmmss.json) */
const extractTimestamp = (filename: string): string => {
  const match = filename.match(/test-input-(\d{14})\.json$/);
  if (match === null || match[1] === undefined) {
    throw new Error(`Invalid input filename format: ${filename}. Expected: test-input-YYYYMMDDHHmmss.json`);
  }
  return match[1];
};

/** Load job data from file */
const loadJobData = (inputPath: string): JobDataFile => {
  const content = fs.readFileSync(inputPath, 'utf-8');
  return JSON.parse(content) as JobDataFile;
};

/** Run prediction and save results */
const runPrediction = (): void => {
  // Get input file from command line argument
  const inputArg = process.argv[2];
  if (inputArg === undefined || inputArg === '') {
    console.error('Usage: npx tsx scripts/predictionEngine.ts <input-file>');
    console.error(
      'Example: npx tsx scripts/predictionEngine.ts packages/redis/src/__tests__/e2e/fixtures/test-input-20240215120000.json'
    );
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const inputFilename = path.basename(inputPath);
  const timestamp = extractTimestamp(inputFilename);

  console.log(`Input file: ${inputPath}`);
  console.log(`Timestamp: ${timestamp}`);

  console.log('\nLoading job data...');
  const jobData = loadJobData(inputPath);
  console.log(`Loaded ${jobData.totalJobs} jobs`);

  console.log('\nRunning prediction simulation...');
  const startTime = Date.now();
  const predictions = predictResults(jobData);
  predictions.jobDataFile = inputFilename;
  const elapsed = Date.now() - startTime;

  console.log(`\nSimulation completed in ${elapsed}ms`);
  console.log('\n=== Prediction Summary ===');
  console.log(`Jobs processed: ${predictions.summary.totalJobsProcessed}`);
  console.log(`Jobs failed: ${predictions.summary.totalJobsFailed}`);
  console.log(`Jobs rejected: ${predictions.summary.totalRejections}`);
  console.log(`Model fallbacks: ${predictions.summary.modelFallbacks}`);
  console.log(`Minute resets: ${predictions.summary.minuteBoundaryResets}`);
  console.log(`Peak concurrent jobs: ${predictions.summary.peakConcurrentJobs}`);
  console.log(`VacationPlanning ratio unchanged: ${predictions.vacationPlanningRatioNeverChanged}`);

  console.log('\nModel usage:');
  for (const [modelId, usage] of Object.entries(predictions.summary.modelUsage)) {
    console.log(
      `  ${modelId}: ${usage.jobs} jobs, ${usage.tokensUsed} tokens, ${usage.requestsUsed} requests`
    );
  }

  console.log('\nFinal ratios:');
  for (const [jobType, ratio] of Object.entries(predictions.finalRatios)) {
    console.log(`  ${jobType}: ${(ratio * 100).toFixed(1)}%`);
  }

  // Save predictions to file (same directory as input, with matching timestamp)
  const outputDirPath = path.dirname(inputPath);
  const outputFilename = getOutputFilename(timestamp);
  const outputPath = path.join(outputDirPath, outputFilename);

  // Save a compact version without the full timeline
  const compactPredictions = {
    ...predictions,
    timelineEventCounts: {
      job_queued: predictions.timeline.filter((e) => e.type === 'job_queued').length,
      job_started: predictions.timeline.filter((e) => e.type === 'job_started').length,
      job_completed: predictions.timeline.filter((e) => e.type === 'job_completed').length,
      job_failed: predictions.timeline.filter((e) => e.type === 'job_failed').length,
      job_rejected: predictions.timeline.filter((e) => e.type === 'job_rejected').length,
      model_fallback: predictions.timeline.filter((e) => e.type === 'model_fallback').length,
      minute_reset: predictions.timeline.filter((e) => e.type === 'minute_reset').length,
      ratio_change: predictions.timeline.filter((e) => e.type === 'ratio_change').length,
    },
    // Keep only first 100 timeline events as a sample
    timeline: predictions.timeline.slice(0, 100),
    fullTimelineLength: predictions.timeline.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(compactPredictions, null, 2));
  console.log(`\nPredictions saved to: ${outputPath}`);
};

// Run if executed directly
runPrediction();
