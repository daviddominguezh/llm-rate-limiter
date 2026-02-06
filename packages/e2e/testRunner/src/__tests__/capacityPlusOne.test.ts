/**
 * Test suite: Capacity Plus One
 *
 * Validates window-based per-model-per-jobType rate limiting.
 *
 * Sends exactly capacity + 1 "summary" jobs distributed evenly across 2 instances.
 * The per-model-per-jobType slot calculation considers multiple dimensions (TPM, RPM,
 * TPD, RPD, totalSlots) and picks the most restrictive. For openai + summary, TPM wins:
 *
 *   Per-instance TPM for openai = 500,000 / 2 instances = 250,000
 *   Per-instance summary rate slots = floor(250,000 × 0.3 ratio / 10,000 tokens) = 7
 *   Total across 2 instances = 14 rate slots per minute window
 *
 * Because TPM is rate-based (not concurrency), these 14 slots represent jobs that can
 * START per minute window. A finishing job does NOT free a rate slot — the tokens are
 * consumed for the entire window. New capacity only appears when the minute resets.
 *
 * Expected behavior:
 * - First 14 jobs start immediately (within the current minute's rate budget)
 * - 15th job waits until the next minute boundary, then starts on openai
 * - All 15 jobs complete (none rejected, none escalated)
 */
import type { JobRecord, TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  INSTANCE_URLS,
  PROXY_URL,
  bootInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

// Per-model-per-jobType rate capacity for "summary" on openai:
// 2 instances x floor(250000 * 0.3 / 10000) = 2 x 7 = 14 rate slots per minute
const OPENAI_SUMMARY_CAPACITY = 14;
// Send capacity + 1 to ensure exactly 1 job exceeds openai summary capacity
const ONE_EXTRA_JOB = 1;
const TOTAL_JOBS = OPENAI_SUMMARY_CAPACITY + ONE_EXTRA_JOB;
const JOB_DURATION_MS = 100;

// Distribute jobs evenly across both instances (1:1 ratio)
const PROXY_RATIO = '1:1';

// Periodic snapshot interval
const SNAPSHOT_INTERVAL_MS = 500;

// Longer timeout since we need to wait for rate limit reset (up to 60s)
const WAIT_TIMEOUT_MS = 90000;
const BEFORE_ALL_TIMEOUT_MS = 150000;

// Index constants
const FIRST_INDEX = 0;
const QUICK_JOB_THRESHOLD_MS = 500;

// Window duration for minute-based rate limits
const MS_PER_MINUTE = 60_000;
const NEXT_MINUTE_OFFSET = 1;
const OPENAI_MODEL_PREFIX = 'openai';

/**
 * Test setup data structure
 */
interface TestSetupData {
  data: TestData;
  jobsSortedBySentTime: JobRecord[];
}

/**
 * Setup test data by running the suite and sorting jobs
 */
const setupTestData = async (): Promise<TestSetupData> => {
  // Each job takes 100ms to process
  const jobs = generateJobsOfType(TOTAL_JOBS, 'summary', {
    prefix: 'capacity-plus-one-test',
    durationMs: JOB_DURATION_MS,
  });

  const data = await runSuite({
    suiteName: 'capacity-plus-one',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: PROXY_RATIO,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  });

  // Sort jobs by when they were sent (sentAt)
  const jobsSortedBySentTime = Object.values(data.jobs).sort((a, b) => a.sentAt - b.sentAt);

  return { data, jobsSortedBySentTime };
};

/**
 * Create empty test setup data for initialization
 */
const createEmptyTestSetup = (): TestSetupData => ({
  data: createEmptyTestData(),
  jobsSortedBySentTime: [],
});

/** Get the minute index (floored epoch minute) of a timestamp */
const minuteOf = (timestamp: number): number => Math.floor(timestamp / MS_PER_MINUTE);

/** Assert that the overflow job waited for the next minute window and ran on openai */
const assertJobWaitedForNextWindow = (jobsSorted: JobRecord[]): void => {
  const [job15] = jobsSorted.slice(OPENAI_SUMMARY_CAPACITY);
  expect(job15).toBeDefined();

  const startedEvent = job15?.events.find((e) => e.type === 'started');
  expect(startedEvent).toBeDefined();

  const sentMinute = minuteOf(job15?.sentAt ?? FIRST_INDEX);
  const startedMinute = minuteOf(startedEvent?.timestamp ?? FIRST_INDEX);

  // Job was sent in minute N but started in minute N+1 (after window reset)
  expect(startedMinute).toBe(sentMinute + NEXT_MINUTE_OFFSET);
  // Job ran on openai after the window reset (not escalated)
  expect(job15?.modelUsed?.startsWith(OPENAI_MODEL_PREFIX)).toBe(true);
};

describe('Capacity Plus One', () => {
  let testSetup: TestSetupData = createEmptyTestSetup();

  beforeAll(async () => {
    await bootInfrastructure();
    testSetup = await setupTestData();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    expect(Object.keys(testSetup.data.jobs).length).toBe(TOTAL_JOBS);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(testSetup.data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(FIRST_INDEX);
  });

  it('should eventually complete all jobs', () => {
    const completedJobs = Object.values(testSetup.data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(TOTAL_JOBS);
  });

  it('should have first 14 jobs complete quickly', () => {
    // First 14 jobs should fit within openai summary capacity (7 per instance x 2)
    const first14Jobs = testSetup.jobsSortedBySentTime.slice(FIRST_INDEX, OPENAI_SUMMARY_CAPACITY);
    const quickJobs = first14Jobs.filter((j) => (j.queueDurationMs ?? FIRST_INDEX) < QUICK_JOB_THRESHOLD_MS);

    // All first 14 jobs should complete quickly (no waiting for rate limit)
    expect(quickJobs.length).toBe(OPENAI_SUMMARY_CAPACITY);
  });

  it('should have the 15th job wait for the next minute window on openai', () => {
    assertJobWaitedForNextWindow(testSetup.jobsSortedBySentTime);
  });

  it('should complete all jobs through the full lifecycle', () => {
    for (const job of Object.values(testSetup.data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });
});
