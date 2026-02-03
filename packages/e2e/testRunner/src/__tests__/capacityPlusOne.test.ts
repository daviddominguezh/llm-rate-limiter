/**
 * Test suite: Capacity Plus One
 *
 * Sends exactly capacity + 1 jobs. The 51st job should be queued and wait
 * until the rate limit capacity is restored (next minute window).
 *
 * Expected behavior:
 * - First 50 jobs complete within rate limit
 * - 51st job waits for capacity (not rejected)
 * - 51st job completes AFTER the rate limit window resets (next minute)
 */
import type { JobRecord, TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// Capacity + 1: 50 jobs + 1 = 51 jobs
const EXACT_CAPACITY = 50;
const CAPACITY_PLUS_ONE = EXACT_CAPACITY + 1;
const JOB_DURATION_MS = 100;

// The 51st job must wait for the next minute window.
// Minimum wait should be significant (at least a few seconds) to prove it waited for rate limit reset.
const MIN_WAIT_FOR_RATE_LIMIT_RESET_MS = 1000;

// Longer timeout since we need to wait for rate limit reset (up to 60s)
const WAIT_TIMEOUT_MS = 90000;
const BEFORE_ALL_TIMEOUT_MS = 150000;

describe('Capacity Plus One', () => {
  let data: TestData;
  let jobsSortedBySentTime: JobRecord[];

  beforeAll(async () => {
    // Each job takes 100ms to process
    const jobs = generateJobsOfType(CAPACITY_PLUS_ONE, 'summary', {
      prefix: 'capacity-plus-one-test',
      durationMs: JOB_DURATION_MS,
    });

    data = await runSuite({
      suiteName: 'capacity-plus-one',
      proxyUrl: PROXY_URL,
      instanceUrls: INSTANCE_URLS,
      jobs,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
    });

    // Sort jobs by when they were sent (sentAt)
    jobsSortedBySentTime = Object.values(data.jobs).sort((a, b) => a.sentAt - b.sentAt);
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should send capacity + 1 jobs', () => {
    expect(Object.keys(data.jobs).length).toBe(CAPACITY_PLUS_ONE);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(0);
  });

  it('should eventually complete all jobs including the 51st', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(CAPACITY_PLUS_ONE);
  });

  it('should have the 51st job wait significantly longer than the first 50', () => {
    // Get the last job (51st, which exceeds capacity)
    const lastJob = jobsSortedBySentTime[CAPACITY_PLUS_ONE - 1];
    expect(lastJob).toBeDefined();

    // Get queue durations for first 50 jobs
    const first50Jobs = jobsSortedBySentTime.slice(0, EXACT_CAPACITY);
    const first50QueueDurations = first50Jobs
      .map((j) => j.queueDurationMs ?? 0)
      .filter((d) => d >= 0);
    const maxFirst50QueueDuration = Math.max(...first50QueueDurations, 0);

    // The 51st job should have waited much longer (for rate limit reset)
    const lastJobQueueDuration = lastJob?.queueDurationMs ?? 0;

    // The 51st job must wait for the next minute window, which should be at least 1 second
    // (unless we happened to start right at the minute boundary, which is unlikely)
    expect(lastJobQueueDuration).toBeGreaterThan(maxFirst50QueueDuration + MIN_WAIT_FOR_RATE_LIMIT_RESET_MS);
  });

  it('should have the 51st job wait for rate limit window reset', () => {
    const lastJob = jobsSortedBySentTime[CAPACITY_PLUS_ONE - 1];
    expect(lastJob).toBeDefined();

    const lastJobQueueDuration = lastJob?.queueDurationMs ?? 0;

    // The job should have waited at least MIN_WAIT_FOR_RATE_LIMIT_RESET_MS
    // This proves it waited for the rate limit to reset, not just for a slot
    expect(lastJobQueueDuration).toBeGreaterThanOrEqual(MIN_WAIT_FOR_RATE_LIMIT_RESET_MS);
  });

  it('should complete all jobs through the full lifecycle', () => {
    for (const job of Object.values(data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });
});
