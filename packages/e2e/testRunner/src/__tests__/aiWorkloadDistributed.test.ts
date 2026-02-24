/**
 * Test suite: AI Workload Distributed Scaling
 *
 * Phase 1: Submit 11 jobs to single instance A (fills Anthropic only), verify processing count
 * Phase 2: Boot instance B, verify in-flight-aware allocation (B gets reduced Anthropic capacity)
 * Phase 3: Wait for brainstorm to complete, verify B's capacity grows
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  ANALYZE_PDF_COUNT,
  ANTHROPIC_POOL_HALF,
  BEFORE_ALL_TIMEOUT_MS,
  BRAINSTORM_COUNT,
  BRAINSTORM_DRAIN_WAIT_MS,
  BRAINSTORM_MAX_MS,
  BRAINSTORM_MIN_MS,
  B_ANTHROPIC_ACQUIRABLE,
  B_OPENAI_ACQUIRABLE,
  CONFIG_PRESET,
  EXPECTED_PROCESSING,
  HTTP_ACCEPTED,
  JOB_ANALYZE_PDF,
  JOB_BRAINSTORM,
  JOB_SUMMARIZE,
  LONG_JOB_MAX_MS,
  LONG_JOB_MIN_MS,
  MODEL_ANTHROPIC,
  MODEL_OPENAI,
  OPENAI_POOL_HALF,
  PHASE_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  POST_BOOT_SETTLE_MS,
  PROCESSING_SETTLE_MS,
  SUMMARIZE_COUNT,
  TWO_INSTANCES,
  bootInstance,
  fetchAllocation,
  getAcquirable,
  getPool,
  getTotalAcquirable,
  killAllInstances,
  setupSingleInstance,
  sleep,
  verifyCapacityInvariant,
  waitForAllocationUpdate,
} from './aiWorkloadDistributedHelpers.js';
import { fetchActiveJobs } from './aiWorkloadHelpers.js';
import { randomDurationMs, submitJob } from './aiWorkloadJobHelpers.js';

// Track B's Phase 2 acquirable for Phase 3 comparison
let phase2TotalAcquirable = 0;

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Distributed Scaling - In-Flight-Aware Pool Allocation', () => {
  beforeAll(async () => {
    await setupSingleInstance();
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'Phase 1: Submit jobs and verify processing count',
    async () => {
      await submitAllJobs();
      await sleep(PROCESSING_SETTLE_MS);
      await verifyPhase1Counts();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 2: Boot B and verify in-flight-aware allocation',
    async () => {
      await bootInstance(PORT_B, CONFIG_PRESET);
      await waitForAllocationUpdate(PORT_A, (alloc) => alloc.instanceCount === TWO_INSTANCES);
      await sleep(POST_BOOT_SETTLE_MS);
      await verifyPhase2Allocation();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 3: Verify B capacity grows after brainstorm drains',
    async () => {
      await sleep(BRAINSTORM_DRAIN_WAIT_MS);
      await verifyPhase3Growth();
    },
    PHASE_TIMEOUT_MS
  );
});

// ---- Job submission helpers ----

/** Submit a single job with random duration */
async function submitExpected(jobId: string, jobType: string, minMs: number, maxMs: number): Promise<void> {
  const duration = randomDurationMs(minMs, maxMs);
  const status = await submitJob(PORT_A, jobId, jobType, { durationMs: duration });
  expect(status).toBe(HTTP_ACCEPTED);
}

/** Submit brainstorm jobs (short duration) */
async function submitBrainstormBatch(): Promise<void> {
  const jobs = Array.from({ length: BRAINSTORM_COUNT }, async (_, i) => {
    await submitExpected(`dist-bs-${String(i)}`, JOB_BRAINSTORM, BRAINSTORM_MIN_MS, BRAINSTORM_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit summarize jobs (long duration) */
async function submitSummarizeBatch(): Promise<void> {
  const jobs = Array.from({ length: SUMMARIZE_COUNT }, async (_, i) => {
    await submitExpected(`dist-sm-${String(i)}`, JOB_SUMMARIZE, LONG_JOB_MIN_MS, LONG_JOB_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit analyzePDF jobs (long duration) */
async function submitAnalyzePdfBatch(): Promise<void> {
  const jobs = Array.from({ length: ANALYZE_PDF_COUNT }, async (_, i) => {
    await submitExpected(`dist-ap-${String(i)}`, JOB_ANALYZE_PDF, LONG_JOB_MIN_MS, LONG_JOB_MAX_MS);
  });
  await Promise.all(jobs);
}

/** Submit all 11 jobs (4 brainstorm + 3 summarize + 4 analyzePDF) */
async function submitAllJobs(): Promise<void> {
  await Promise.all([submitBrainstormBatch(), submitSummarizeBatch(), submitAnalyzePdfBatch()]);
}

// ---- Phase verification helpers ----

/** Verify Phase 1: all 11 jobs processing (fills Anthropic exactly) */
async function verifyPhase1Counts(): Promise<void> {
  const { activeJobs } = await fetchActiveJobs(PORT_A);
  const { length: processing } = activeJobs.filter((j) => j.status === 'processing');
  expect(processing).toBe(EXPECTED_PROCESSING);
}

/** Verify Phase 2: pools halved, B acquirable reduced, invariant holds */
async function verifyPhase2Allocation(): Promise<void> {
  const allocB = await fetchAllocation(PORT_B);
  expect(getPool(allocB, MODEL_ANTHROPIC).totalSlots).toBe(ANTHROPIC_POOL_HALF);
  expect(getPool(allocB, MODEL_OPENAI).totalSlots).toBe(OPENAI_POOL_HALF);
  expect(getAcquirable(allocB, MODEL_ANTHROPIC)).toBe(B_ANTHROPIC_ACQUIRABLE);
  expect(getAcquirable(allocB, MODEL_OPENAI)).toBe(B_OPENAI_ACQUIRABLE);
  phase2TotalAcquirable = getTotalAcquirable(allocB);
  await verifyCapacityInvariant();
}

/** Verify Phase 3: B's capacity grew after brainstorm drained */
async function verifyPhase3Growth(): Promise<void> {
  const allocB = await fetchAllocation(PORT_B);
  const phase3Total = getTotalAcquirable(allocB);
  expect(phase3Total).toBeGreaterThan(phase2TotalAcquirable);
  await verifyCapacityInvariant();
}
