/**
 * Constants and helpers for the AI Workload Distributed Scaling E2E test.
 *
 * Config: ai-workload
 * Verifies in-flight-aware pool allocation when a second instance joins.
 *
 * Strategy: Submit exactly enough jobs to fill Anthropic (11 slots).
 * Jobs wait up to 60s on Anthropic before escalating to OpenAI,
 * so we fill only Anthropic to keep the test fast.
 *
 * Pool slots (2 instances, avgTokens=30K):
 * - Anthropic: floor(450K/30K/2) = 7 per instance
 * - OpenAI: floor(1M/30K/2) = 16 per instance
 */
import type { ModelPoolAllocation } from '@llm-rate-limiter/core';

import {
  type AllocationResponse,
  bootInstance,
  cleanRedis,
  fetchAllocation,
  killAllInstances,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// ---- Ports & Config ----
export const PORT_A = 4001;
export const PORT_B = 4002;
export const CONFIG_PRESET: ConfigPresetName = 'ai-workload';

// ---- Models ----
export const MODEL_ANTHROPIC = 'anthropic-opus-4.6';
export const MODEL_OPENAI = 'openai-gpt-5.2';
export const ALL_MODELS = [MODEL_ANTHROPIC, MODEL_OPENAI] as const;

// ---- Job types ----
export const JOB_BRAINSTORM = 'brainstorm';
export const JOB_SUMMARIZE = 'summarize';
export const JOB_ANALYZE_PDF = 'analyzePDF';

// ---- HTTP ----
export const HTTP_ACCEPTED = 202;

// ---- Instance counts ----
export const TWO_INSTANCES = 2;
const ZERO = 0;

// ---- Pool totalSlots per instance (2 instances) ----
export const ANTHROPIC_POOL_HALF = 7;
export const OPENAI_POOL_HALF = 16;

// ---- Phase 1: Anthropic per-jobType slots (1 instance) ----
// Submit exactly enough to fill all Anthropic slots (4+3+4 = 11)
export const BRAINSTORM_COUNT = 4;
export const SUMMARIZE_COUNT = 3;
export const ANALYZE_PDF_COUNT = 4;
export const EXPECTED_PROCESSING = 11;

// ---- Phase 2: Expected acquirable slots for B ----
// Anthropic: globalBase=14, globalInFlight=11, available=3
// B acquirable: floor(7 * 3 / 7) = 3
export const B_ANTHROPIC_ACQUIRABLE = 3;
// OpenAI: globalBase=32, globalInFlight=0, available=32 → B acquirable=16 (full)
export const B_OPENAI_ACQUIRABLE = 16;

// ---- Duration ranges (ms) ----
export const BRAINSTORM_MIN_MS = 10000;
export const BRAINSTORM_MAX_MS = 15000;
export const LONG_JOB_MIN_MS = 50000;
export const LONG_JOB_MAX_MS = 60000;

// ---- Timing (ms) ----
const ALLOCATION_PROPAGATION_MS = 2000;
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const PHASE_TIMEOUT_MS = 90000;
export const PROCESSING_SETTLE_MS = 2000;
export const POST_BOOT_SETTLE_MS = 2000;

// Phase 3: wait for brainstorm drain + reallocation propagation
const REALLOCATION_BUFFER_MS = 5000;
export const BRAINSTORM_DRAIN_WAIT_MS = BRAINSTORM_MAX_MS + REALLOCATION_BUFFER_MS;

// ---- Setup ----

/** Boot a single instance with ai-workload config */
export const setupSingleInstance = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

// ---- Allocation helpers ----

/** Get pool for a model from allocation response, throwing if missing */
export const getPool = (response: AllocationResponse, modelId: string): ModelPoolAllocation => {
  const pool = response.allocation?.pools[modelId];
  if (pool === undefined) {
    throw new Error(`No pool for model ${modelId}`);
  }
  return pool;
};

/** Get acquirable slots for a model (falls back to totalSlots if absent) */
export const getAcquirable = (response: AllocationResponse, modelId: string): number => {
  const pool = getPool(response, modelId);
  return pool.acquirableSlots ?? pool.totalSlots;
};

/** Get total acquirable across all models */
export const getTotalAcquirable = (response: AllocationResponse): number => {
  let total = 0;
  for (const modelId of ALL_MODELS) {
    total += getAcquirable(response, modelId);
  }
  return total;
};

/** Verify invariant: A.acquirable + B.acquirable ≤ globalBase per model */
export const verifyCapacityInvariant = async (): Promise<void> => {
  const [allocA, allocB] = await Promise.all([fetchAllocation(PORT_A), fetchAllocation(PORT_B)]);
  const instanceCount = allocA.allocation?.instanceCount ?? ZERO;
  for (const modelId of ALL_MODELS) {
    const globalBase = getPool(allocA, modelId).totalSlots * instanceCount;
    const sumAcq = getAcquirable(allocA, modelId) + getAcquirable(allocB, modelId);
    expect(sumAcq).toBeLessThanOrEqual(globalBase);
  }
};

// Re-exports
export { fetchAllocation, bootInstance, killAllInstances, waitForAllocationUpdate };
export { sleep } from '../testUtils.js';
