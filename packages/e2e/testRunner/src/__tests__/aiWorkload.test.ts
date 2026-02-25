/**
 * Test suite: Real World (distributed test with data collection)
 *
 * Phase 1: Verify initial per-model per-job-type slot allocation (1 instance)
 * Phase 2: Fill Summarize on Anthropic (4 jobs, 3 slots), verify 3 running + 1 queued + ratio adjustment
 * Phase 3: Send mixed brainstorm+summarize batch, verify brainstorm recovers ratio from summarize
 * Phase 4: Submit 15 jobs to single instance A, wait for escalation, verify A is heavily loaded
 * Phase 5: Boot instance B, verify pools halved, B gets reduced capacity
 * Phase 6: Wait for brainstorm to drain, verify invariant, submit jobs to B
 * Phase 7: Wait for all jobs to drain, verify both instances have equal capacity (halves of total)
 */
import {
  BRAINSTORM_DRAIN_WAIT_MS,
  DIST_PHASE_TIMEOUT_MS,
  EQUALIZATION_WAIT_MS,
  ESCALATION_WAIT_MS,
  bootAndVerifyDistribution,
  submitDistributedJobs,
  submitJobsToB,
  verifyCapacityEqualized,
  verifyCapacityInvariant,
  verifyHeavyLoad,
} from './aiWorkloadDistributedHelpers.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  ANTHROPIC_ANALYZE_PDF_SLOTS,
  ANTHROPIC_BRAINSTORM_SLOTS,
  ANTHROPIC_SUMMARIZE_SLOTS,
  BASE_URL_A,
  BASE_URL_B,
  BEFORE_ALL_TIMEOUT_MS,
  FIXED_RATIO,
  HTTP_ACCEPTED,
  JOB_ANALYZE_PDF,
  JOB_BRAINSTORM,
  JOB_SUMMARIZE,
  MAX_ADJUSTED_BRAINSTORM_RATIO,
  MAX_RECOVERED_SUMMARIZE_RATIO,
  MIN_ADJUSTED_SUMMARIZE_RATIO,
  MIN_RECOVERED_BRAINSTORM_RATIO,
  MODEL_ANTHROPIC,
  MODEL_OPENAI,
  OPENAI_ANALYZE_PDF_SLOTS,
  OPENAI_BRAINSTORM_SLOTS,
  OPENAI_SUMMARIZE_SLOTS,
  PHASE_TIMEOUT_MS,
  PORT_A,
  RATIO_CHECK_DELAY_MS,
  RUNNING_CHECK_DELAY_MS,
  countQueuedByType,
  countRunningByType,
  fetchActiveJobs,
  fetchStats,
  getJobTypeInFlight,
  getJobTypeRatio,
  getJobTypeStats,
  getModelSlots,
  killAllInstances,
  setupSingleInstance,
  sleep,
} from './aiWorkloadHelpers.js';
import {
  BRAINSTORM_MAX_DURATION_MS,
  BRAINSTORM_MIN_DURATION_MS,
  type DataCollectionContext,
  SUMMARIZE_MAX_DURATION_MS,
  SUMMARIZE_MIN_DURATION_MS,
  createDataCollection,
  randomDurationMs,
  saveAndStopCollection,
  setActiveCollector,
  startDataCollection,
  submitJob,
} from './aiWorkloadJobHelpers.js';

const SUITE_NAME = 'realWorld';

// Phase 2: 4 summarize jobs fill Anthropic (3 slots), 1 queued
const SUMMARIZE_FILL_COUNT = 4;
const EXPECTED_RUNNING = 3;
const EXPECTED_IN_FLIGHT = 4;
const EXPECTED_QUEUED = 1;

// Phase 3: 13 brainstorm + 1 summarize to trigger brainstorm ratio recovery
const BRAINSTORM_FILL_COUNT = 13;
const PHASE3_SUMMARIZE_COUNT = 1;
// Submit Phase 3 jobs 3s before the earliest Phase 2 summarize can finish (guarantees overlap)
const PHASE3_EARLY_SUBMIT_MS = 3000;
// Time from Phase 3 submit until all Phase 2 summarize drain (worst case):
// MAX_DURATION - (MIN_DURATION - EARLY_SUBMIT) = 35s - 17s = 18s
const PHASE2_DRAIN_FROM_P3_MS =
  SUMMARIZE_MAX_DURATION_MS - SUMMARIZE_MIN_DURATION_MS + PHASE3_EARLY_SUBMIT_MS;
// Total wait after Phase 3 submit: drain + ratio adjustment cycle
const PHASE3_RATIO_WAIT_MS = PHASE2_DRAIN_FROM_P3_MS + RATIO_CHECK_DELAY_MS;

let ctx: DataCollectionContext | null = null;

afterAll(async () => {
  setActiveCollector(null);
  if (ctx !== null) {
    await saveAndStopCollection(ctx, SUITE_NAME);
  }
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Real World - Slot Allocation & Ratio Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance();
    ctx = createDataCollection([BASE_URL_A, BASE_URL_B]);
    setActiveCollector(ctx.collector);
    await startDataCollection(ctx);
  }, BEFORE_ALL_TIMEOUT_MS);

  it(
    'Phase 1: Initial slot allocation matches expected values',
    async () => {
      const stats = await fetchStats(PORT_A);
      const jtStats = getJobTypeStats(stats);
      verifyAnthropicSlots(jtStats);
      verifyOpenAISlots(jtStats);
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 2: Fill Summarize capacity and verify ratio adjustment',
    async () => {
      await submitSummarizeJobs();
      await sleep(RUNNING_CHECK_DELAY_MS);
      await verifyRunningAndQueued();
      await sleep(RATIO_CHECK_DELAY_MS - RUNNING_CHECK_DELAY_MS);
      await verifyRatioAdjustment();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 3: Brainstorm recovery after load shift',
    async () => {
      await sleep(SUMMARIZE_MIN_DURATION_MS - RATIO_CHECK_DELAY_MS - PHASE3_EARLY_SUBMIT_MS);
      await submitMixedBatch();
      await sleep(PHASE3_RATIO_WAIT_MS);
      await verifyRecoveredRatios();
    },
    PHASE_TIMEOUT_MS
  );
});

describe('Distributed Scaling - In-Flight-Aware Pool Allocation', () => {
  it(
    'Phase 4: Submit 15 jobs and verify A is heavily loaded after escalation',
    async () => {
      await submitDistributedJobs();
      await sleep(ESCALATION_WAIT_MS);
      await verifyHeavyLoad();
    },
    DIST_PHASE_TIMEOUT_MS
  );

  it(
    'Phase 5: Boot B, verify in-flight-aware allocation',
    async () => {
      await bootAndVerifyDistribution();
    },
    DIST_PHASE_TIMEOUT_MS
  );

  it(
    'Phase 6: Verify invariant holds, submit jobs to B',
    async () => {
      await sleep(BRAINSTORM_DRAIN_WAIT_MS);
      await verifyCapacityInvariant();
      await submitJobsToB();
    },
    DIST_PHASE_TIMEOUT_MS
  );

  it(
    'Phase 7: Verify capacity equalizes after all jobs drain',
    async () => {
      await sleep(EQUALIZATION_WAIT_MS);
      await verifyCapacityEqualized();
    },
    DIST_PHASE_TIMEOUT_MS
  );
});

/** Verify Anthropic per-model per-jobType slots */
function verifyAnthropicSlots(jtStats: ReturnType<typeof getJobTypeStats>): void {
  expect(getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_BRAINSTORM)).toBe(ANTHROPIC_BRAINSTORM_SLOTS);
  expect(getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_SUMMARIZE)).toBe(ANTHROPIC_SUMMARIZE_SLOTS);
  expect(getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_ANALYZE_PDF)).toBe(ANTHROPIC_ANALYZE_PDF_SLOTS);
}

/** Verify OpenAI per-model per-jobType slots */
function verifyOpenAISlots(jtStats: ReturnType<typeof getJobTypeStats>): void {
  expect(getModelSlots(jtStats, MODEL_OPENAI, JOB_BRAINSTORM)).toBe(OPENAI_BRAINSTORM_SLOTS);
  expect(getModelSlots(jtStats, MODEL_OPENAI, JOB_SUMMARIZE)).toBe(OPENAI_SUMMARIZE_SLOTS);
  expect(getModelSlots(jtStats, MODEL_OPENAI, JOB_ANALYZE_PDF)).toBe(OPENAI_ANALYZE_PDF_SLOTS);
}

/** Submit a job with random duration and verify accepted */
async function submitExpectedJob(
  jobId: string,
  jobType: string,
  minMs: number,
  maxMs: number
): Promise<void> {
  const durationMs = randomDurationMs(minMs, maxMs);
  const status = await submitJob(PORT_A, jobId, jobType, { durationMs });
  expect(status).toBe(HTTP_ACCEPTED);
}

/** Submit 4 summarize jobs with random durations (20-35s each) */
async function submitSummarizeJobs(): Promise<void> {
  const submissions = Array.from({ length: SUMMARIZE_FILL_COUNT }, async (_, i) => {
    await submitExpectedJob(
      `summarize-${String(i)}`,
      JOB_SUMMARIZE,
      SUMMARIZE_MIN_DURATION_MS,
      SUMMARIZE_MAX_DURATION_MS
    );
  });
  await Promise.all(submissions);
}

/** Submit 13 brainstorm + 1 summarize jobs with random durations */
async function submitMixedBatch(): Promise<void> {
  const brainstormJobs = Array.from({ length: BRAINSTORM_FILL_COUNT }, async (_, i) => {
    await submitExpectedJob(
      `brainstorm-${String(i)}`,
      JOB_BRAINSTORM,
      BRAINSTORM_MIN_DURATION_MS,
      BRAINSTORM_MAX_DURATION_MS
    );
  });
  const summarizeJobs = Array.from({ length: PHASE3_SUMMARIZE_COUNT }, async (_, i) => {
    await submitExpectedJob(
      `summarize-p3-${String(i)}`,
      JOB_SUMMARIZE,
      SUMMARIZE_MIN_DURATION_MS,
      SUMMARIZE_MAX_DURATION_MS
    );
  });
  await Promise.all([...brainstormJobs, ...summarizeJobs]);
}

/** Verify 3 running on Anthropic + 1 queued */
async function verifyRunningAndQueued(): Promise<void> {
  const stats = await fetchStats(PORT_A);
  const jtStats = getJobTypeStats(stats);
  expect(getJobTypeInFlight(jtStats, JOB_SUMMARIZE)).toBe(EXPECTED_IN_FLIGHT);
  const activeJobs = await fetchActiveJobs(PORT_A);
  expect(countRunningByType(activeJobs.activeJobs, JOB_SUMMARIZE)).toBe(EXPECTED_RUNNING);
  expect(countQueuedByType(activeJobs.activeJobs, JOB_SUMMARIZE)).toBe(EXPECTED_QUEUED);
}

/** Verify Phase 2 ratio adjustment: Brainstorm donated to Summarize */
async function verifyRatioAdjustment(): Promise<void> {
  const stats = await fetchStats(PORT_A);
  const jtStats = getJobTypeStats(stats);
  expect(getJobTypeRatio(jtStats, JOB_ANALYZE_PDF)).toBe(FIXED_RATIO);
  expect(getJobTypeRatio(jtStats, JOB_SUMMARIZE)).toBeGreaterThan(MIN_ADJUSTED_SUMMARIZE_RATIO);
  expect(getJobTypeRatio(jtStats, JOB_BRAINSTORM)).toBeLessThan(MAX_ADJUSTED_BRAINSTORM_RATIO);
}

/** Verify Phase 3: Brainstorm recovered ratio, Summarize decreased */
async function verifyRecoveredRatios(): Promise<void> {
  const stats = await fetchStats(PORT_A);
  const jtStats = getJobTypeStats(stats);
  expect(getJobTypeRatio(jtStats, JOB_ANALYZE_PDF)).toBe(FIXED_RATIO);
  expect(getJobTypeRatio(jtStats, JOB_BRAINSTORM)).toBeGreaterThan(MIN_RECOVERED_BRAINSTORM_RATIO);
  expect(getJobTypeRatio(jtStats, JOB_SUMMARIZE)).toBeLessThan(MAX_RECOVERED_SUMMARIZE_RATIO);
}
