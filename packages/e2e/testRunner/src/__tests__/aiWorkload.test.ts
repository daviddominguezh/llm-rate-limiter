/**
 * Test suite: AI Workload (distributed test with data collection)
 *
 * Phase 1: Verify initial per-model per-job-type slot allocation (1 instance)
 * Phase 2: Fill Summarize capacity on Anthropic, verify queuing and ratio adjustment
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
  MIN_ADJUSTED_SUMMARIZE_RATIO,
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
  type DataCollectionContext,
  SUMMARIZE_JOB_DURATION_MS,
  createDataCollection,
  saveAndStopCollection,
  setActiveCollector,
  startDataCollection,
  submitJob,
} from './aiWorkloadJobHelpers.js';

const SUITE_NAME = 'ai-workload';
const SUMMARIZE_FILL_COUNT = 4;
const EXPECTED_RUNNING = 3;
const EXPECTED_QUEUED = 1;

let ctx: DataCollectionContext | null = null;

afterAll(async () => {
  setActiveCollector(null);
  if (ctx !== null) {
    await saveAndStopCollection(ctx, SUITE_NAME);
  }
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('AI Workload - Slot Allocation & Ratio Adjustment', () => {
  beforeAll(async () => {
    await setupSingleInstance();
    ctx = createDataCollection([BASE_URL_A]);
    setActiveCollector(ctx.collector);
    await startDataCollection(ctx);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

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
});

/** Verify Anthropic per-model per-jobType slots */
function verifyAnthropicSlots(jtStats: ReturnType<typeof getJobTypeStats>): void {
  const brainstorm = getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_BRAINSTORM);
  const summarize = getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_SUMMARIZE);
  const analyzePDF = getModelSlots(jtStats, MODEL_ANTHROPIC, JOB_ANALYZE_PDF);

  expect(brainstorm).toBe(ANTHROPIC_BRAINSTORM_SLOTS);
  expect(summarize).toBe(ANTHROPIC_SUMMARIZE_SLOTS);
  expect(analyzePDF).toBe(ANTHROPIC_ANALYZE_PDF_SLOTS);
}

/** Verify OpenAI per-model per-jobType slots */
function verifyOpenAISlots(jtStats: ReturnType<typeof getJobTypeStats>): void {
  const brainstorm = getModelSlots(jtStats, MODEL_OPENAI, JOB_BRAINSTORM);
  const summarize = getModelSlots(jtStats, MODEL_OPENAI, JOB_SUMMARIZE);
  const analyzePDF = getModelSlots(jtStats, MODEL_OPENAI, JOB_ANALYZE_PDF);

  expect(brainstorm).toBe(OPENAI_BRAINSTORM_SLOTS);
  expect(summarize).toBe(OPENAI_SUMMARIZE_SLOTS);
  expect(analyzePDF).toBe(OPENAI_ANALYZE_PDF_SLOTS);
}

/** Submit 4 summarize jobs with long duration */
async function submitSummarizeJobs(): Promise<void> {
  const payload = { durationMs: SUMMARIZE_JOB_DURATION_MS };
  const submissions = Array.from({ length: SUMMARIZE_FILL_COUNT }, async (_, i) => {
    const status = await submitJob(PORT_A, `summarize-${String(i)}`, JOB_SUMMARIZE, payload);
    expect(status).toBe(HTTP_ACCEPTED);
  });
  await Promise.all(submissions);
}

/** Verify 3 running and 1 queued summarize jobs */
async function verifyRunningAndQueued(): Promise<void> {
  const stats = await fetchStats(PORT_A);
  const jtStats = getJobTypeStats(stats);
  const inFlight = getJobTypeInFlight(jtStats, JOB_SUMMARIZE);
  expect(inFlight).toBe(EXPECTED_RUNNING);

  const activeJobs = await fetchActiveJobs(PORT_A);
  const queued = countQueuedByType(activeJobs.activeJobs, JOB_SUMMARIZE);
  expect(queued).toBe(EXPECTED_QUEUED);
}

/** Verify ratio adjustment: Brainstorm donated to Summarize, AnalyzePDF unchanged */
async function verifyRatioAdjustment(): Promise<void> {
  const stats = await fetchStats(PORT_A);
  const jtStats = getJobTypeStats(stats);

  const summarizeRatio = getJobTypeRatio(jtStats, JOB_SUMMARIZE);
  const brainstormRatio = getJobTypeRatio(jtStats, JOB_BRAINSTORM);
  const analyzePDFRatio = getJobTypeRatio(jtStats, JOB_ANALYZE_PDF);

  expect(analyzePDFRatio).toBe(FIXED_RATIO);
  expect(summarizeRatio).toBeGreaterThan(MIN_ADJUSTED_SUMMARIZE_RATIO);
  expect(brainstormRatio).toBeLessThan(MAX_ADJUSTED_BRAINSTORM_RATIO);
}
