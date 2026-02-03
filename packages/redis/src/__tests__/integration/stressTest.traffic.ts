/**
 * Bursty traffic generator for stress tests.
 * Uses recursive patterns to avoid await-in-loop issues.
 */
import type { RedisBackendInstance } from '../../types.js';
import type { JobTypeName, StressTestMetrics } from './stressTest.helpers.js';
import {
  BURST_DURATION_MS,
  BURST_JOBS_PER_TICK,
  INSTANCE_COUNT,
  LULL_DURATION_MS,
  LULL_JOB_PROBABILITY,
  ONE,
  TICK_INTERVAL_MS,
  TOTAL_JOBS,
  ZERO,
  runJob,
  selectJobType,
} from './stressTest.helpers.js';
import { delay } from './testSetup.js';

interface TrafficGeneratorContext {
  backends: RedisBackendInstance[];
  metrics: StressTestMetrics;
  pendingJobs: Array<Promise<void>>;
  jobsScheduled: number;
}

/**
 * Schedule a single job to the appropriate backend.
 */
const scheduleJob = (ctx: TrafficGeneratorContext): number => {
  const { backends, metrics, pendingJobs, jobsScheduled } = ctx;
  const jobType = selectJobType();
  const backendIndex = jobsScheduled % INSTANCE_COUNT;
  const { [backendIndex]: backend } = backends;
  const instanceId = `stress-inst-${backendIndex}`;

  if (backend !== undefined) {
    const jobPromise = runJob(backend, instanceId, jobType, metrics);
    pendingJobs.push(jobPromise);
    return jobsScheduled + ONE;
  }
  return jobsScheduled;
};

/**
 * Calculate how many jobs to schedule in a burst tick.
 */
const getBurstTickJobs = (jobsScheduled: number): number => {
  const remaining = TOTAL_JOBS - jobsScheduled;
  return Math.min(BURST_JOBS_PER_TICK, remaining);
};

/**
 * Schedule a batch of burst jobs.
 */
const scheduleBurstBatch = (ctx: TrafficGeneratorContext): number => {
  let { jobsScheduled } = ctx;
  const jobsToSchedule = getBurstTickJobs(jobsScheduled);

  for (let i = ZERO; i < jobsToSchedule; i += ONE) {
    jobsScheduled = scheduleJob({ ...ctx, jobsScheduled });
  }

  return jobsScheduled;
};

/**
 * Schedule a single lull job if probability check passes.
 */
const scheduleLullJob = (ctx: TrafficGeneratorContext): number => {
  if (Math.random() < LULL_JOB_PROBABILITY) {
    return scheduleJob(ctx);
  }
  return ctx.jobsScheduled;
};

/**
 * Run burst phase using recursive scheduling.
 */
const runBurstPhaseRecursive = async (ctx: TrafficGeneratorContext, endTime: number): Promise<number> => {
  if (Date.now() >= endTime || ctx.jobsScheduled >= TOTAL_JOBS) {
    return ctx.jobsScheduled;
  }

  const updatedCount = scheduleBurstBatch(ctx);
  await delay(TICK_INTERVAL_MS);

  return await runBurstPhaseRecursive({ ...ctx, jobsScheduled: updatedCount }, endTime);
};

/**
 * Run lull phase using recursive scheduling.
 */
const runLullPhaseRecursive = async (ctx: TrafficGeneratorContext, endTime: number): Promise<number> => {
  if (Date.now() >= endTime || ctx.jobsScheduled >= TOTAL_JOBS) {
    return ctx.jobsScheduled;
  }

  const updatedCount = scheduleLullJob(ctx);
  await delay(TICK_INTERVAL_MS);

  return await runLullPhaseRecursive({ ...ctx, jobsScheduled: updatedCount }, endTime);
};

/**
 * Run a complete burst-lull cycle.
 */
const runTrafficCycle = async (ctx: TrafficGeneratorContext): Promise<number> => {
  const burstEnd = Date.now() + BURST_DURATION_MS;
  const postBurstCount = await runBurstPhaseRecursive(ctx, burstEnd);

  const lullEnd = Date.now() + LULL_DURATION_MS;
  const postLullCount = await runLullPhaseRecursive({ ...ctx, jobsScheduled: postBurstCount }, lullEnd);

  return postLullCount;
};

/**
 * Generate traffic recursively until all jobs are scheduled.
 */
const generateTrafficRecursive = async (ctx: TrafficGeneratorContext): Promise<number> => {
  if (ctx.jobsScheduled >= TOTAL_JOBS) {
    return ctx.jobsScheduled;
  }

  const updatedCount = await runTrafficCycle(ctx);
  return await generateTrafficRecursive({ ...ctx, jobsScheduled: updatedCount });
};

/**
 * Generate bursty traffic pattern.
 * Alternates between burst phases (high rate) and lull phases (low rate).
 */
export const generateBurstyTraffic = async (
  backends: RedisBackendInstance[],
  metrics: StressTestMetrics
): Promise<Array<Promise<void>>> => {
  const pendingJobs: Array<Promise<void>> = [];
  const ctx: TrafficGeneratorContext = { backends, metrics, pendingJobs, jobsScheduled: ZERO };

  await generateTrafficRecursive(ctx);

  return pendingJobs;
};

/**
 * Calculate total processed jobs from metrics.
 */
export const getTotalProcessed = (metrics: StressTestMetrics): number => {
  let totalProcessed = ZERO;
  const jobTypes: JobTypeName[] = ['critical', 'highPri', 'normal', 'lowPri', 'background'];

  for (const jobType of jobTypes) {
    const { jobsByType } = metrics;
    const { [jobType]: typeMetrics } = jobsByType;
    if (typeMetrics !== undefined) {
      totalProcessed += typeMetrics.started + typeMetrics.rejected;
    }
  }

  return totalProcessed;
};
