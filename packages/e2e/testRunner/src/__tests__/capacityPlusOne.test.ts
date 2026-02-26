/**
 * Test suite: Capacity Plus One
 *
 * Validates window-based per-model rate limiting with a dedicated config.
 *
 * Uses the capacityPlusOne config: single job type (summary) on openai with TPM=140K.
 * Single instance: floor(140K / 10K avgTokens / 1 instance) = 14 rate slots.
 * JTM locally: summary ratio=1.0 → all 14 slots go to summary.
 *
 * Because TPM is rate-based (not concurrency), these 14 slots represent jobs that can
 * START per minute window. A finishing job does NOT free a rate slot — the tokens are
 * consumed for the entire window. New capacity only appears when the minute resets.
 *
 * Expected behavior:
 * - First 14 jobs start immediately (within the current minute's rate budget)
 * - 15th job waits until the next minute boundary, then starts
 * - All 15 jobs complete (none rejected)
 */
import type { JobRecord, TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  PROXY_URL,
  SINGLE_INSTANCE_URLS,
  bootSingleInstanceInfrastructure,
  teardownInfrastructure,
} from './infrastructureHelpers.js';
import { createEmptyTestData } from './testHelpers.js';

// Per-model rate capacity for "summary" on openai (capacityPlusOne config):
// 1 instance: floor(140000 / 10000 / 1) = 14 rate slots per minute
const OPENAI_SUMMARY_CAPACITY = 14;
// Send capacity + 1 to ensure exactly 1 job exceeds openai summary capacity
const ONE_EXTRA_JOB = 1;
const TOTAL_JOBS = OPENAI_SUMMARY_CAPACITY + ONE_EXTRA_JOB;
// Random job duration range (5–40 seconds)
const MIN_JOB_DURATION_MS = 5000;
const MAX_JOB_DURATION_MS = 40000;

// Periodic snapshot interval
const SNAPSHOT_INTERVAL_MS = 500;

// Longer timeout: jobs take up to 40s, plus up to 60s for rate-limit window reset
const WAIT_TIMEOUT_MS = 180000;
const BEFORE_ALL_TIMEOUT_MS = 240000;

// Index constants
const FIRST_INDEX = 0;
const QUICK_JOB_THRESHOLD_MS = 500;

// Window duration for minute-based rate limits
const MS_PER_MINUTE = 60_000;
const NEXT_MINUTE_OFFSET = 1;

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
  // Each job runs for a random duration between 5–40 seconds
  const jobs = generateJobsOfType(TOTAL_JOBS, 'summary', {
    prefix: 'capacity-plus-one-test',
    durationMs: { min: MIN_JOB_DURATION_MS, max: MAX_JOB_DURATION_MS },
  });

  const data = await runSuite({
    suiteName: 'capacity-plus-one',
    proxyUrl: PROXY_URL,
    instanceUrls: SINGLE_INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
    waitForMinuteBoundary: true,
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

/** Assert that the overflow job waited for the next minute window */
const assertJobWaitedForNextWindow = (jobsSorted: JobRecord[]): void => {
  const [job15] = jobsSorted.slice(OPENAI_SUMMARY_CAPACITY);
  expect(job15).toBeDefined();

  const startedEvent = job15?.events.find((e) => e.type === 'started');
  expect(startedEvent).toBeDefined();

  const sentMinute = minuteOf(job15?.sentAt ?? FIRST_INDEX);
  const startedMinute = minuteOf(startedEvent?.timestamp ?? FIRST_INDEX);

  // Job was sent in minute N but started in minute N+1 (after window reset)
  expect(startedMinute).toBe(sentMinute + NEXT_MINUTE_OFFSET);
};

/** Assert that the overflow job ran on openai (not escalated to a fallback model) */
const OPENAI_MODEL_PREFIX = 'openai/';
const assertOverflowJobRanOnOpenai = (jobsSorted: JobRecord[]): void => {
  const [job15] = jobsSorted.slice(OPENAI_SUMMARY_CAPACITY);
  expect(job15).toBeDefined();
  expect(job15?.modelUsed).toBeDefined();
  expect(job15?.modelUsed?.startsWith(OPENAI_MODEL_PREFIX)).toBe(true);
};

describe('Capacity Plus One', () => {
  let testSetup: TestSetupData = createEmptyTestSetup();

  beforeAll(async () => {
    await bootSingleInstanceInfrastructure('capacityPlusOne');
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
    // First 14 jobs should fit within openai summary capacity (14 per single instance)
    const first14Jobs = testSetup.jobsSortedBySentTime.slice(FIRST_INDEX, OPENAI_SUMMARY_CAPACITY);
    const quickJobs = first14Jobs.filter((j) => (j.queueDurationMs ?? FIRST_INDEX) < QUICK_JOB_THRESHOLD_MS);

    // All first 14 jobs should complete quickly (no waiting for rate limit)
    expect(quickJobs.length).toBe(OPENAI_SUMMARY_CAPACITY);
  });

  it('should have the 15th job wait for the next minute window', () => {
    assertJobWaitedForNextWindow(testSetup.jobsSortedBySentTime);
  });

  it('should have the 15th job run on openai (not escalated)', () => {
    assertOverflowJobRanOnOpenai(testSetup.jobsSortedBySentTime);
  });

  it('should complete all jobs through the full lifecycle', () => {
    for (const job of Object.values(testSetup.data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });
});
