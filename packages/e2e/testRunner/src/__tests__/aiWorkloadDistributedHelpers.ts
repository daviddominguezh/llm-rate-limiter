/**
 * Constants and helpers for the distributed scaling phases of AI Workload test.
 *
 * Phases 4-7 in aiWorkload.test.ts verify in-flight-aware pool allocation
 * when a second instance joins while A has jobs running.
 *
 * Instance A continues from Phases 1-3 with stale ratios (bs~47%, sm~3%, ap=50%).
 * JTM idle decay gradually restores ratios toward initial values between phases.
 * JTM wait queue drain ensures waiters wake when allocatedSlots increase.
 *
 * Strategy: Submit 15 jobs (5 brainstorm + 5 summarize + 5 analyzePDF).
 * With stale ratios, JTM adjusts within 5s (sm gets more slots via donation).
 * Overflows escalate to OpenAI after 60s maxWaitMS.
 * All durations > 68s so no jobs finish before Phase 5 boot (~T=68).
 * B receives mixed jobs via submitJobsToB() in Phase 6.
 *
 * Pool slots (1 instance): Anthropic=15, OpenAI=33
 * Pool slots (2 instances): Anthropic=7, OpenAI=16 per instance
 */
import type { ModelPoolAllocation } from '@llm-rate-limiter/core';

import {
  type AllocationResponse,
  bootInstance,
  fetchAllocation,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import { sleep } from '../testUtils.js';
import { logEqualizationDebug } from './aiWorkloadDebugHelpers.js';
import {
  CONFIG_PRESET,
  HTTP_ACCEPTED,
  MODEL_ANTHROPIC,
  MODEL_OPENAI,
  PORT_A,
  PORT_B,
  fetchActiveJobs,
} from './aiWorkloadHelpers.js';
import { randomDurationMs, submitJob } from './aiWorkloadJobHelpers.js';

// ---- Models ----
const ALL_MODELS = [MODEL_ANTHROPIC, MODEL_OPENAI] as const;

// ---- Instance counts ----
const TWO_INSTANCES = 2;
const ONE = 1;
const ZERO = 0;

// ---- Job counts (5 each, 15 total — overflow fits in OpenAI with no cycling) ----
const BRAINSTORM_COUNT = 5;
const SUMMARIZE_COUNT = 5;
const ANALYZE_PDF_COUNT = 5;
/** A is "heavily loaded" when at least this many jobs are processing */
const MIN_PROCESSING = 10;

// ---- Job types ----
const JOB_BRAINSTORM = 'brainstorm';
const JOB_SUMMARIZE = 'summarize';
const JOB_ANALYZE_PDF = 'analyzePDF';

// ---- Duration ranges (ms) ----
// All durations > 68s so jobs are still running when B boots at Phase 5 (~T=68)
// Short enough for 1-generation drain: Anthropic by T≈82, OpenAI by T≈142
const DIST_BRAINSTORM_MIN_MS = 72000;
const DIST_BRAINSTORM_MAX_MS = 77000;
const DIST_LONG_MIN_MS = 77000;
const DIST_LONG_MAX_MS = 82000;

// ---- Timing (ms) ----
/** Wait for Anthropic maxWaitMS (60s) + buffer for OpenAI acquisition */
export const ESCALATION_WAIT_MS = 63000;
const POST_BOOT_SETTLE_MS = 2000;
/** Brainstorm max=77s; Phase 6 starts ~71s after submission → 20s generous wait */
export const BRAINSTORM_DRAIN_WAIT_MS = 20000;
/** Initial wait before polling for equalization (most jobs finish by then) */
export const EQUALIZATION_WAIT_MS = 30000;
/** Polling: check every 5s for up to 90s after initial wait */
const EQUALIZATION_POLL_INTERVAL_MS = 5000;
const EQUALIZATION_POLL_MAX = 18;
export const DIST_PHASE_TIMEOUT_MS = 180000;

// ---- B job submission ----
const B_BRAINSTORM_COUNT = 3;
const B_SUMMARIZE_COUNT = 3;
const B_ANALYZE_PDF_COUNT = 2;
const B_JOB_MIN_MS = 15000;
const B_JOB_MAX_MS = 25000;

// ---- Allocation helpers ----

/** Get pool for a model from allocation response, throwing if missing */
const getPool = (response: AllocationResponse, modelId: string): ModelPoolAllocation => {
  const pool = response.allocation?.pools[modelId];
  if (pool === undefined) {
    throw new Error(`No pool for model ${modelId}`);
  }
  return pool;
};

/** Get acquirable slots for a model (falls back to totalSlots if absent) */
const getAcquirable = (response: AllocationResponse, modelId: string): number => {
  const pool = getPool(response, modelId);
  return pool.acquirableSlots ?? pool.totalSlots;
};

// ---- Submit helpers ----

/** Submit a single job with random duration and verify accepted */
async function submitExpected(jobId: string, jobType: string, minMs: number, maxMs: number): Promise<void> {
  const duration = randomDurationMs(minMs, maxMs);
  const status = await submitJob(PORT_A, jobId, jobType, { durationMs: duration });
  expect(status).toBe(HTTP_ACCEPTED);
}

/** Submit brainstorm jobs (72-77s, drains from Anthropic before Phase 6) */
async function submitBrainstormBatch(): Promise<void> {
  const jobs = Array.from({ length: BRAINSTORM_COUNT }, async (_, i) => {
    await submitExpected(
      `dist-bs-${String(i)}`,
      JOB_BRAINSTORM,
      DIST_BRAINSTORM_MIN_MS,
      DIST_BRAINSTORM_MAX_MS
    );
  });
  await Promise.all(jobs);
}

/** Submit summarize jobs (72-77s, same range as brainstorm) */
async function submitSummarizeBatch(): Promise<void> {
  const jobs = Array.from({ length: SUMMARIZE_COUNT }, async (_, i) => {
    await submitExpected(
      `dist-sm-${String(i)}`,
      JOB_SUMMARIZE,
      DIST_BRAINSTORM_MIN_MS,
      DIST_BRAINSTORM_MAX_MS
    );
  });
  await Promise.all(jobs);
}

/** Submit analyzePDF jobs (77-82s, drains from Anthropic before Phase 6) */
async function submitAnalyzePdfBatch(): Promise<void> {
  const jobs = Array.from({ length: ANALYZE_PDF_COUNT }, async (_, i) => {
    await submitExpected(`dist-ap-${String(i)}`, JOB_ANALYZE_PDF, DIST_LONG_MIN_MS, DIST_LONG_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit all 15 distributed jobs (5 brainstorm + 5 summarize + 5 analyzePDF) */
export async function submitDistributedJobs(): Promise<void> {
  await Promise.all([submitBrainstormBatch(), submitSummarizeBatch(), submitAnalyzePdfBatch()]);
}

// ---- Verify helpers ----

/** Verify A is heavily loaded (most jobs processing after escalation) */
export async function verifyHeavyLoad(): Promise<void> {
  const { activeJobs } = await fetchActiveJobs(PORT_A);
  const { length: processing } = activeJobs.filter((j) => j.status === 'processing');
  process.stderr.write(
    `[P4-DBG] A active: ${String(activeJobs.length)}, processing: ${String(processing)}\n`
  );
  for (const j of activeJobs) {
    process.stderr.write(`[P4-DBG]   ${j.jobId}[${j.jobType}]:${j.status}\n`);
  }
  expect(processing).toBeGreaterThanOrEqual(MIN_PROCESSING);
}

/** Check that both instances received equal pool totalSlots per model */
function verifyPoolsMatched(allocA: AllocationResponse, allocB: AllocationResponse): void {
  for (const modelId of ALL_MODELS) {
    const { totalSlots: slotsA } = getPool(allocA, modelId);
    const { totalSlots: slotsB } = getPool(allocB, modelId);
    expect(slotsA).toBe(slotsB);
  }
}

/** B's total acquirable across models must be less than total pool (A's in-flight reduces it) */
function verifyBCapacityReduced(allocB: AllocationResponse): void {
  const totalAcquirable = ALL_MODELS.reduce((sum, m) => sum + getAcquirable(allocB, m), ZERO);
  const totalPoolSlots = ALL_MODELS.reduce((sum, m) => sum + getPool(allocB, m).totalSlots, ZERO);
  expect(totalAcquirable).toBeLessThan(totalPoolSlots);
}

/** Verify invariant: A.acquirable + B.acquirable ≤ globalBase per model */
export async function verifyCapacityInvariant(): Promise<void> {
  const [allocA, allocB] = await Promise.all([fetchAllocation(PORT_A), fetchAllocation(PORT_B)]);
  const instanceCount = allocA.allocation?.instanceCount ?? ZERO;
  for (const modelId of ALL_MODELS) {
    const globalBase = getPool(allocA, modelId).totalSlots * instanceCount;
    const sumAcq = getAcquirable(allocA, modelId) + getAcquirable(allocB, modelId);
    expect(sumAcq).toBeLessThanOrEqual(globalBase);
  }
}

/** Boot B, verify pools halved, B capacity reduced, invariant holds */
export async function bootAndVerifyDistribution(): Promise<void> {
  await bootInstance(PORT_B, CONFIG_PRESET);
  await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
  await sleep(POST_BOOT_SETTLE_MS);
  const [allocA, allocB] = await Promise.all([fetchAllocation(PORT_A), fetchAllocation(PORT_B)]);
  verifyPoolsMatched(allocA, allocB);
  verifyBCapacityReduced(allocB);
  await verifyCapacityInvariant();
}

// ---- B job submission ----

/** Submit a single job to B with random duration */
async function submitToB(jobId: string, jobType: string): Promise<void> {
  const duration = randomDurationMs(B_JOB_MIN_MS, B_JOB_MAX_MS);
  const status = await submitJob(PORT_B, jobId, jobType, { durationMs: duration });
  expect(status).toBe(HTTP_ACCEPTED);
}

/** Submit 8 jobs to B (3 brainstorm + 3 summarize + 2 analyzePDF) */
export async function submitJobsToB(): Promise<void> {
  const brainstorm = Array.from({ length: B_BRAINSTORM_COUNT }, async (_, i) => {
    await submitToB(`b-bs-${String(i)}`, JOB_BRAINSTORM);
  });
  const summarize = Array.from({ length: B_SUMMARIZE_COUNT }, async (_, i) => {
    await submitToB(`b-sm-${String(i)}`, JOB_SUMMARIZE);
  });
  const analyzePdf = Array.from({ length: B_ANALYZE_PDF_COUNT }, async (_, i) => {
    await submitToB(`b-ap-${String(i)}`, JOB_ANALYZE_PDF);
  });
  await Promise.all([...brainstorm, ...summarize, ...analyzePdf]);
}

// ---- Equalization verification ----

/** Check if a single model has equal capacity between both instances */
function isModelEqualized(allocA: AllocationResponse, allocB: AllocationResponse, modelId: string): boolean {
  const poolA = getPool(allocA, modelId);
  const poolB = getPool(allocB, modelId);
  const slotsMatch = poolA.totalSlots === poolB.totalSlots;
  const aFull = getAcquirable(allocA, modelId) === poolA.totalSlots;
  const bFull = getAcquirable(allocB, modelId) === poolB.totalSlots;
  return slotsMatch && aFull && bFull;
}

interface AllocationPair {
  allocA: AllocationResponse;
  allocB: AllocationResponse;
}

/** Fetch both allocations and check if all models are equalized */
async function fetchAndCheckEqualized(): Promise<AllocationPair & { equalized: boolean }> {
  const [allocA, allocB] = await Promise.all([fetchAllocation(PORT_A), fetchAllocation(PORT_B)]);
  const equalized = ALL_MODELS.every((m) => isModelEqualized(allocA, allocB, m));
  return { allocA, allocB, equalized };
}

/** Recursively poll until capacity equalizes or attempts exhausted */
async function pollForEqualization(attemptsLeft: number, attempt: number): Promise<AllocationPair> {
  const result = await fetchAndCheckEqualized();
  await logEqualizationDebug(result.allocA, result.allocB, attempt);
  if (result.equalized || attemptsLeft <= ZERO) return result;
  await sleep(EQUALIZATION_POLL_INTERVAL_MS);
  return await pollForEqualization(attemptsLeft - ONE, attempt + ONE);
}

/** Poll until both instances have equal capacity (all jobs drained), then assert */
export async function verifyCapacityEqualized(): Promise<void> {
  const { allocA, allocB } = await pollForEqualization(EQUALIZATION_POLL_MAX, ZERO);
  for (const modelId of ALL_MODELS) {
    const poolA = getPool(allocA, modelId);
    const poolB = getPool(allocB, modelId);
    expect(poolA.totalSlots).toBe(poolB.totalSlots);
    expect(getAcquirable(allocA, modelId)).toBe(poolA.totalSlots);
    expect(getAcquirable(allocB, modelId)).toBe(poolB.totalSlots);
  }
}
