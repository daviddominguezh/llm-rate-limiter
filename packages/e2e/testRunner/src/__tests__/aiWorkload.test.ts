/**
 * Test suite: Real World (distributed test with data collection)
 *
 * Phase 1: Verify initial per-model per-job-type slot allocation (1 instance)
 * Phase 2: Fill Summarize on Anthropic (4 jobs, 3 slots), verify 3 running + 1 queued + ratio adjustment
 * Phase 3: Send mixed brainstorm+summarize batch, verify brainstorm recovers ratio from summarize
 */
import {
  AFTER_ALL_TIMEOUT_MS,
  ANTHROPIC_ANALYZE_PDF_SLOTS,
  ANTHROPIC_BRAINSTORM_SLOTS,
  ANTHROPIC_SUMMARIZE_SLOTS,
  BASE_URL_A,
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
// Submit Phase 3 jobs 3s before Phase 2 summarize jobs finish (overlap)
const PHASE3_EARLY_SUBMIT_MS = 3000;

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
    ctx = createDataCollection([BASE_URL_A]);
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
      await sleep(SUMMARIZE_MAX_DURATION_MS - RATIO_CHECK_DELAY_MS - PHASE3_EARLY_SUBMIT_MS);
      await submitMixedBatch();
      await sleep(RATIO_CHECK_DELAY_MS);
      await verifyRecoveredRatios();
    },
    PHASE_TIMEOUT_MS
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
