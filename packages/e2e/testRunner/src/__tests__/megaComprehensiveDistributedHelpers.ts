/**
 * Phase 6-9 assertion helpers for mega comprehensive test.
 * Distributed phases: scaling, global tracking, allocation changes, time windows.
 */
import { sleep } from '../testUtils.js';
import {
  EXPECTED_ONE_INSTANCE,
  EXPECTED_TWO_INSTANCES,
  HTTP_ACCEPTED,
  JOB_CRITICAL,
  JOB_STANDARD,
  MODEL_ALPHA,
  PORT_A,
  PORT_B,
  REALLOCATION_WAKE_THRESHOLD_MS,
  SINGLE_INSTANCE_ALPHA_SLOTS,
  TWO_INSTANCE_ALPHA_SLOTS,
  fetchAllocation,
  killInstanceBAndWaitForReallocation,
} from './megaComprehensiveHelpers.js';
import {
  MEDIUM_JOB_DURATION_MS,
  standardPayload,
  submitJob,
  waitForJobResult,
  zeroTokenPayload,
} from './megaComprehensiveJobHelpers.js';

const WAIT_AFTER_JOBS_MS = 500;
const MINUTE_IN_MS = 60000;
const MS_PER_SECOND = 1000;
const MINUTE_BOUNDARY_BUFFER_MS = 2000;
const ZERO_SLOTS = 0;

/** Get pool slots for model-alpha from a specific port */
const getAlphaSlots = async (port: number): Promise<number> => {
  const alloc = await fetchAllocation(port);
  return alloc.allocation?.pools[MODEL_ALPHA]?.totalSlots ?? ZERO_SLOTS;
};

/** Phase 6: Verify instance scaling and pool redistribution */
export const verifyInstanceScaling = async (): Promise<void> => {
  await verifyTwoInstanceAllocation();
  await verifySlotsPerInstance();
};

/** Verify both instances report 2 instances */
const verifyTwoInstanceAllocation = async (): Promise<void> => {
  const allocA = await fetchAllocation(PORT_A);
  const allocB = await fetchAllocation(PORT_B);
  expect(allocA.allocation?.instanceCount).toBe(EXPECTED_TWO_INSTANCES);
  expect(allocB.allocation?.instanceCount).toBe(EXPECTED_TWO_INSTANCES);
};

/** Verify each instance has reduced slots */
const verifySlotsPerInstance = async (): Promise<void> => {
  const slotsA = await getAlphaSlots(PORT_A);
  const slotsB = await getAlphaSlots(PORT_B);
  expect(slotsA).toBe(TWO_INSTANCE_ALPHA_SLOTS);
  expect(slotsB).toBe(TWO_INSTANCE_ALPHA_SLOTS);
};

/** Phase 7: Verify distributed operations */
export const verifyDistributedOps = async (): Promise<void> => {
  await verifyDistributedAcquire();
  await verifyIndependentWaitQueues();
};

/** Verify distributed acquire - both instances decrement Redis */
const verifyDistributedAcquire = async (): Promise<void> => {
  const statusA = await submitJob(PORT_A, 'dist-a1', JOB_STANDARD, zeroTokenPayload());
  const statusB = await submitJob(PORT_B, 'dist-b1', JOB_STANDARD, zeroTokenPayload());
  expect(statusA).toBe(HTTP_ACCEPTED);
  expect(statusB).toBe(HTTP_ACCEPTED);

  const resultA = await waitForJobResult(PORT_A, 'dist-a1');
  const resultB = await waitForJobResult(PORT_B, 'dist-b1');
  expect(resultA.status).toBe('completed');
  expect(resultB.status).toBe('completed');
};

/** Verify independent wait queues per instance */
const verifyIndependentWaitQueues = async (): Promise<void> => {
  const s1 = await submitJob(PORT_A, 'wq-a1', JOB_CRITICAL, zeroTokenPayload(MEDIUM_JOB_DURATION_MS));
  const s2 = await submitJob(PORT_A, 'wq-a2', JOB_CRITICAL, zeroTokenPayload(MEDIUM_JOB_DURATION_MS));
  const s3 = await submitJob(PORT_B, 'wq-b1', JOB_CRITICAL, zeroTokenPayload(MEDIUM_JOB_DURATION_MS));
  expect(s1).toBe(HTTP_ACCEPTED);
  expect(s2).toBe(HTTP_ACCEPTED);
  expect(s3).toBe(HTTP_ACCEPTED);

  const resultB1 = await waitForJobResult(PORT_B, 'wq-b1');
  expect(resultB1.status).toBe('completed');

  const resultA1 = await waitForJobResult(PORT_A, 'wq-a1');
  const resultA2 = await waitForJobResult(PORT_A, 'wq-a2');
  expect(resultA1.status).toBe('completed');
  expect(resultA2.status).toBe('completed');
};

/** Phase 8: Verify allocation change wakes queued job */
export const verifyAllocationChangeWakesQueue = async (): Promise<void> => {
  await fillAndQueueOnA();
  await killBAndVerifyQueueWake();
};

/** Fill slot on A and queue a job */
const fillAndQueueOnA = async (): Promise<void> => {
  const fillStatus = await submitJob(
    PORT_A,
    'fill-alloc',
    JOB_CRITICAL,
    zeroTokenPayload(MEDIUM_JOB_DURATION_MS)
  );
  expect(fillStatus).toBe(HTTP_ACCEPTED);

  await sleep(WAIT_AFTER_JOBS_MS);

  const queueStatus = await submitJob(PORT_A, 'queued-alloc', JOB_CRITICAL, zeroTokenPayload());
  expect(queueStatus).toBe(HTTP_ACCEPTED);
};

/** Kill B, verify reallocation, verify queued job wakes */
const killBAndVerifyQueueWake = async (): Promise<void> => {
  await killInstanceBAndWaitForReallocation();

  const allocAfter = await fetchAllocation(PORT_A);
  expect(allocAfter.allocation?.instanceCount).toBe(EXPECTED_ONE_INSTANCE);

  const slotsAfter = await getAlphaSlots(PORT_A);
  expect(slotsAfter).toBe(SINGLE_INSTANCE_ALPHA_SLOTS);

  const fillResult = await waitForJobResult(PORT_A, 'fill-alloc');
  expect(fillResult.status).toBe('completed');

  const queuedResult = await waitForJobResult(PORT_A, 'queued-alloc');
  expect(queuedResult.status).toBe('completed');

  if (queuedResult.queueDuration !== undefined) {
    expect(queuedResult.queueDuration).toBeLessThan(REALLOCATION_WAKE_THRESHOLD_MS);
  }
};

/** Get milliseconds until next minute boundary */
const getMsUntilNextMinute = (): number => {
  const now = new Date();
  const secondsIntoMinute = now.getSeconds();
  const msIntoSecond = now.getMilliseconds();
  return MINUTE_IN_MS - (secondsIntoMinute * MS_PER_SECOND + msIntoSecond);
};

/** Phase 9: Verify time window boundary behavior */
export const verifyTimeWindowBoundary = async (): Promise<void> => {
  const msToWait = getMsUntilNextMinute();
  await sleep(msToWait + MINUTE_BOUNDARY_BUFFER_MS);
  await submitCrossWindowJob();
};

/** Submit a job and verify it completes (crossing minute boundary) */
const submitCrossWindowJob = async (): Promise<void> => {
  const status = await submitJob(
    PORT_A,
    'cross-window',
    JOB_STANDARD,
    standardPayload(MEDIUM_JOB_DURATION_MS)
  );
  expect(status).toBe(HTTP_ACCEPTED);

  const result = await waitForJobResult(PORT_A, 'cross-window');
  expect(result.status).toBe('completed');
  expect(result.modelUsed).toBe(MODEL_ALPHA);
};
