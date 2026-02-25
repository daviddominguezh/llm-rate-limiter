/**
 * Temporary debug helpers for diagnosing Phase 7 equalization issues.
 * Logs active jobs and allocation state during polling.
 */
import type { ModelPoolAllocation } from '@llm-rate-limiter/core';

import type { AllocationResponse } from '../instanceLifecycle.js';
import { MODEL_ANTHROPIC, MODEL_OPENAI, PORT_A, PORT_B, fetchActiveJobs } from './aiWorkloadHelpers.js';

const ALL_MODELS = [MODEL_ANTHROPIC, MODEL_OPENAI] as const;

/** Write a debug line to stderr (bypasses no-console rule) */
function dbg(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** Extract pool from allocation, returning null if missing */
function safeGetPool(response: AllocationResponse, modelId: string): ModelPoolAllocation | null {
  return response.allocation?.pools[modelId] ?? null;
}

/** Format a single instance's allocation for one model */
function formatModelAlloc(response: AllocationResponse, modelId: string): string {
  const pool = safeGetPool(response, modelId);
  if (pool === null) return 'no-pool';
  const acq = pool.acquirableSlots ?? pool.totalSlots;
  return `acq=${String(acq)}/${String(pool.totalSlots)}`;
}

/** Log allocation state for both instances across all models */
function logAllocations(allocA: AllocationResponse, allocB: AllocationResponse): void {
  for (const modelId of ALL_MODELS) {
    const aStr = formatModelAlloc(allocA, modelId);
    const bStr = formatModelAlloc(allocB, modelId);
    dbg(`[EQ-DBG] ${modelId}: A(${aStr}) B(${bStr})`);
  }
}

/** Log active jobs for a single instance */
async function logActiveJobs(label: string, port: number): Promise<void> {
  const { activeJobs, count } = await fetchActiveJobs(port);
  const summary = activeJobs.map((j) => `${j.jobId}[${j.jobType}]:${j.status}`);
  dbg(`[EQ-DBG] ${label} active: ${String(count)} jobs`);
  for (const entry of summary) {
    dbg(`[EQ-DBG]   ${entry}`);
  }
}

/** Log full debug state: allocations + active jobs on both instances */
export async function logEqualizationDebug(
  allocA: AllocationResponse,
  allocB: AllocationResponse,
  attempt: number
): Promise<void> {
  dbg(`[EQ-DBG] === Poll attempt ${String(attempt)} ===`);
  logAllocations(allocA, allocB);
  await Promise.all([logActiveJobs('A', PORT_A), logActiveJobs('B', PORT_B)]);
}
