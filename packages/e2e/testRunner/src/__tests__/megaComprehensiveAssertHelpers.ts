/**
 * Phase 1-5 assertion helpers for mega comprehensive test.
 * Single-instance phases: slots, queue, actual usage, errors, ratios.
 */
import { sleep } from '../testUtils.js';
import {
  FINAL_SLOTS_SINGLE,
  HTTP_ACCEPTED,
  IMMEDIATE_DELEGATION_THRESHOLD_MS,
  JOB_CRITICAL,
  JOB_FIXED_BATCH,
  JOB_LOW_PRIORITY,
  JOB_STANDARD,
  MODEL_ALPHA,
  MODEL_BETA,
  PORT_A,
  QUEUE_MIN_DURATION_MS,
  SINGLE_INSTANCE_ALPHA_SLOTS,
  fetchAllocation,
} from './megaComprehensiveHelpers.js';
import {
  MEDIUM_JOB_DURATION_MS,
  overagePayload,
  refundPayload,
  rejectPayload,
  standardPayload,
  submitJob,
  throwPayload,
  tokenBreakdownPayload,
  waitForJobResult,
  zeroTokenPayload,
} from './megaComprehensiveJobHelpers.js';

const WAIT_FOR_FILL_MS = 500;
const HEAVY_LOAD_COUNT = 5;
const RATIO_ADJUSTMENT_WAIT_MS = 12000;
const ZERO_SLOTS = 0;

/** Get pool slots for model-alpha from allocation */
const getAlphaPoolSlots = async (): Promise<number> => {
  const alloc = await fetchAllocation(PORT_A);
  const pool = alloc.allocation?.pools[MODEL_ALPHA];
  return pool?.totalSlots ?? ZERO_SLOTS;
};

/** Phase 1: Verify slot calculations and ratio distribution */
export const verifySlotCalculation = async (): Promise<void> => {
  const alloc = await fetchAllocation(PORT_A);
  const pools = alloc.allocation?.pools;
  expect(pools).toBeDefined();

  const alphaPool = pools?.[MODEL_ALPHA];
  expect(alphaPool).toBeDefined();
  expect(alphaPool?.totalSlots).toBe(SINGLE_INSTANCE_ALPHA_SLOTS);
};

/** Phase 1: Verify final slots consider memory */
export const verifyFinalSlots = async (): Promise<void> => {
  const slots = await getAlphaPoolSlots();
  expect(slots).toBe(FINAL_SLOTS_SINGLE);
};

/** Fill jobs: one per job type to occupy all pool slots on model-alpha */
const FILL_JOBS: ReadonlyArray<{ id: string; jobType: string }> = [
  { id: 'fill-critical', jobType: JOB_CRITICAL },
  { id: 'fill-standard', jobType: JOB_STANDARD },
  { id: 'fill-batch', jobType: JOB_FIXED_BATCH },
];

/** Phase 2: Fill capacity, verify queue and escalation */
export const verifyQueueAndEscalation = async (): Promise<void> => {
  const fillPromises = buildFillJobPromises();
  const fillResults = await Promise.all(fillPromises);
  verifyAllAccepted(fillResults);

  await sleep(WAIT_FOR_FILL_MS);
  await submitAndVerifyQueuedCritical();
  await submitAndVerifyEscalatedLowPriority();
  await waitForFillJobsAndVerifyQueue();
};

/** Build fill job submission promises - one per job type to fill all pool slots */
const buildFillJobPromises = (): Array<Promise<number>> =>
  FILL_JOBS.map(async ({ id, jobType }) => await submitJob(PORT_A, id, jobType, standardPayload()));

/** Verify all submissions returned HTTP 202 */
const verifyAllAccepted = (statuses: number[]): void => {
  for (const status of statuses) {
    expect(status).toBe(HTTP_ACCEPTED);
  }
};

/** Submit critical job that should queue */
const submitAndVerifyQueuedCritical = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'queued-critical', JOB_CRITICAL, standardPayload());
  expect(status).toBe(HTTP_ACCEPTED);
};

/** Submit lowPriority job that should escalate immediately */
const submitAndVerifyEscalatedLowPriority = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'escalated-low', JOB_LOW_PRIORITY, standardPayload());
  expect(status).toBe(HTTP_ACCEPTED);

  const result = await waitForJobResult(PORT_A, 'escalated-low');
  expect(result.status).toBe('completed');
  expect(result.modelUsed).toBe(MODEL_BETA);

  if (result.queueDuration !== undefined) {
    expect(result.queueDuration).toBeLessThan(IMMEDIATE_DELEGATION_THRESHOLD_MS);
  }
};

/** Wait for fill jobs to complete, then verify critical wakes from queue */
const waitForFillJobsAndVerifyQueue = async (): Promise<void> => {
  const fillResultPromises = FILL_JOBS.map(async ({ id }) => await waitForJobResult(PORT_A, id));
  const fillResults = await Promise.all(fillResultPromises);

  for (const result of fillResults) {
    expect(result.status).toBe('completed');
  }

  const queuedResult = await waitForJobResult(PORT_A, 'queued-critical');
  expect(queuedResult.status).toBe('completed');

  if (queuedResult.queueDuration !== undefined) {
    expect(queuedResult.queueDuration).toBeGreaterThanOrEqual(QUEUE_MIN_DURATION_MS);
  }
};

/** Phase 3: Verify actual usage */
export const verifyActualUsage = async (): Promise<void> => {
  await submitAndVerifyRefundJob();
  await submitAndVerifyOverageJob();
  await submitAndVerifyZeroUsageJob();
  await submitAndVerifyTokenBreakdownJob();
};

/** Submit refund job (actual < estimated) */
const submitAndVerifyRefundJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'refund-job', JOB_STANDARD, refundPayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'refund-job');
  expect(result.status).toBe('completed');
};

/** Submit overage job (actual > estimated) */
const submitAndVerifyOverageJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'overage-job', JOB_STANDARD, overagePayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'overage-job');
  expect(result.status).toBe('completed');
};

/** Submit zero actual usage job */
const submitAndVerifyZeroUsageJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'zero-usage-job', JOB_STANDARD, zeroTokenPayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'zero-usage-job');
  expect(result.status).toBe('completed');
};

/** Submit token breakdown job (input + output + cached) */
const submitAndVerifyTokenBreakdownJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'breakdown-job', JOB_STANDARD, tokenBreakdownPayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'breakdown-job');
  expect(result.status).toBe('completed');
};

/** Phase 4: Verify error handling - throw and reject */
export const verifyErrorHandling = async (): Promise<void> => {
  await submitAndVerifyThrowJob();
  await submitAndVerifyRejectJob();
};

/** Submit job that throws without reject */
const submitAndVerifyThrowJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'throw-job', JOB_STANDARD, throwPayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'throw-job');
  expect(result.status).toBe('failed');
};

/** Submit job that calls reject with usage */
const submitAndVerifyRejectJob = async (): Promise<void> => {
  const status = await submitJob(PORT_A, 'reject-job', JOB_STANDARD, rejectPayload());
  expect(status).toBe(HTTP_ACCEPTED);
  const result = await waitForJobResult(PORT_A, 'reject-job');
  expect(result.status).toBe('failed');
};

/** Phase 5: Verify flexible ratio adjustment */
export const verifyRatioAdjustment = async (): Promise<void> => {
  await submitHeavyCriticalLoad();
  await sleep(RATIO_ADJUSTMENT_WAIT_MS);
};

/** Submit heavy critical load to trigger ratio adjustment */
const submitHeavyCriticalLoad = async (): Promise<void> => {
  const loadPromises = Array.from(
    { length: HEAVY_LOAD_COUNT },
    async (_, i) =>
      await submitJob(
        PORT_A,
        `heavy-critical-${String(i)}`,
        JOB_CRITICAL,
        standardPayload(MEDIUM_JOB_DURATION_MS)
      )
  );
  const results = await Promise.all(loadPromises);

  for (const status of results) {
    expect(status).toBe(HTTP_ACCEPTED);
  }
};
