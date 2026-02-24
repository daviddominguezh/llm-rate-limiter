/**
 * Constants and helpers for the distributed scaling phases of AI Workload test.
 *
 * Phases 4-6 in aiWorkload.test.ts verify in-flight-aware pool allocation
 * when a second instance joins while A has jobs running.
 *
 * Strategy: Submit 35 jobs (15 brainstorm + 10 summarize + 10 analyzePDF).
 * All durations > 60s so no jobs finish during Anthropic's maxWaitMS (60s).
 * After escalation, most jobs are processing on both Anthropic and OpenAI.
 *
 * Pool slots (2 instances, avgTokens=30K):
 * - Anthropic: floor(450K/30K/2) = 7 per instance
 * - OpenAI: floor(1M/30K/2) = 16 per instance
 */
import type { ModelPoolAllocation } from '@llm-rate-limiter/core';

import {
  type AllocationResponse,
  bootInstance,
  fetchAllocation,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import { sleep } from '../testUtils.js';
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
const ZERO = 0;

// ---- Pool totalSlots per instance (2 instances) ----
const ANTHROPIC_POOL_HALF = 7;
const OPENAI_POOL_HALF = 16;

// ---- Job counts ----
const BRAINSTORM_COUNT = 15;
const SUMMARIZE_COUNT = 10;
const ANALYZE_PDF_COUNT = 10;
const MIN_PROCESSING = 30;

// ---- Job types ----
const JOB_BRAINSTORM = 'brainstorm';
const JOB_SUMMARIZE = 'summarize';
const JOB_ANALYZE_PDF = 'analyzePDF';

// ---- Duration ranges (ms) ----
// All durations > 60s so no Anthropic jobs finish during maxWaitMS escalation
const DIST_BRAINSTORM_MIN_MS = 70000;
const DIST_BRAINSTORM_MAX_MS = 80000;
const DIST_LONG_MIN_MS = 120000;
const DIST_LONG_MAX_MS = 150000;

// ---- Timing (ms) ----
/** Wait for Anthropic maxWaitMS (60s) + buffer for OpenAI acquisition */
export const ESCALATION_WAIT_MS = 63000;
const POST_BOOT_SETTLE_MS = 2000;
/** Brainstorm max=80s; Phase 6 starts ~71s after submission → 20s generous wait */
export const BRAINSTORM_DRAIN_WAIT_MS = 20000;
export const DIST_PHASE_TIMEOUT_MS = 120000;

// ---- Phase state ----
let phase5TotalAcquirable = 0;

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

/** Get total acquirable across all models */
const getTotalAcquirable = (response: AllocationResponse): number => {
  let total = 0;
  for (const modelId of ALL_MODELS) {
    total += getAcquirable(response, modelId);
  }
  return total;
};

// ---- Submit helpers ----

/** Submit a single job with random duration and verify accepted */
async function submitExpected(jobId: string, jobType: string, minMs: number, maxMs: number): Promise<void> {
  const duration = randomDurationMs(minMs, maxMs);
  const status = await submitJob(PORT_A, jobId, jobType, { durationMs: duration });
  expect(status).toBe(HTTP_ACCEPTED);
}

/** Submit brainstorm jobs (70-80s, finishes for Phase 6) */
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

/** Submit summarize jobs (120-150s, stays running throughout) */
async function submitSummarizeBatch(): Promise<void> {
  const jobs = Array.from({ length: SUMMARIZE_COUNT }, async (_, i) => {
    await submitExpected(`dist-sm-${String(i)}`, JOB_SUMMARIZE, DIST_LONG_MIN_MS, DIST_LONG_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit analyzePDF jobs (120-150s, stays running throughout) */
async function submitAnalyzePdfBatch(): Promise<void> {
  const jobs = Array.from({ length: ANALYZE_PDF_COUNT }, async (_, i) => {
    await submitExpected(`dist-ap-${String(i)}`, JOB_ANALYZE_PDF, DIST_LONG_MIN_MS, DIST_LONG_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit all 35 distributed jobs (15 brainstorm + 10 summarize + 10 analyzePDF) */
export async function submitDistributedJobs(): Promise<void> {
  await Promise.all([submitBrainstormBatch(), submitSummarizeBatch(), submitAnalyzePdfBatch()]);
}

// ---- Verify helpers ----

/** Verify A is heavily loaded (most jobs processing after escalation) */
export async function verifyHeavyLoad(): Promise<void> {
  const { activeJobs } = await fetchActiveJobs(PORT_A);
  const { length: processing } = activeJobs.filter((j) => j.status === 'processing');
  expect(processing).toBeGreaterThanOrEqual(MIN_PROCESSING);
}

/** Check that both instances have halved pool totalSlots */
function verifyPoolsHalved(allocA: AllocationResponse, allocB: AllocationResponse): void {
  expect(getPool(allocA, MODEL_ANTHROPIC).totalSlots).toBe(ANTHROPIC_POOL_HALF);
  expect(getPool(allocA, MODEL_OPENAI).totalSlots).toBe(OPENAI_POOL_HALF);
  expect(getPool(allocB, MODEL_ANTHROPIC).totalSlots).toBe(ANTHROPIC_POOL_HALF);
  expect(getPool(allocB, MODEL_OPENAI).totalSlots).toBe(OPENAI_POOL_HALF);
}

/** B's acquirable must be less than its totalSlots (reduced by A's in-flight) */
function verifyBCapacityReduced(allocB: AllocationResponse): void {
  const bAnthropicAcq = getAcquirable(allocB, MODEL_ANTHROPIC);
  const bOpenAIAcq = getAcquirable(allocB, MODEL_OPENAI);
  const { totalSlots: bAnthropicTotal } = getPool(allocB, MODEL_ANTHROPIC);
  const { totalSlots: bOpenAITotal } = getPool(allocB, MODEL_OPENAI);
  expect(bAnthropicAcq).toBeLessThan(bAnthropicTotal);
  expect(bOpenAIAcq).toBeLessThan(bOpenAITotal);
}

/** Verify invariant: A.acquirable + B.acquirable ≤ globalBase per model */
async function verifyCapacityInvariant(): Promise<void> {
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
  verifyPoolsHalved(allocA, allocB);
  verifyBCapacityReduced(allocB);
  phase5TotalAcquirable = getTotalAcquirable(allocB);
  await verifyCapacityInvariant();
}

/** Verify B's capacity grew after brainstorm drained */
export async function verifyCapacityGrowth(): Promise<void> {
  const allocB = await fetchAllocation(PORT_B);
  const phase6Total = getTotalAcquirable(allocB);
  expect(phase6Total).toBeGreaterThan(phase5TotalAcquirable);
  await verifyCapacityInvariant();
}
