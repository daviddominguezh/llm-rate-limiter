import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];
const NUM_JOBS = 20;
const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;

describe('Rate Limit Queuing', () => {
  let data: TestData;

  beforeAll(async () => {
    // Send enough jobs to potentially exceed rate limit capacity
    // Using 'summary' type which estimates 1 request and 10000 tokens per job
    // Each job takes 100ms to process
    const jobs = generateJobsOfType(NUM_JOBS, 'summary', {
      prefix: 'queuing-test',
      durationMs: JOB_DURATION_MS,
    });

    data = await runSuite({
      suiteName: 'rate-limit-queuing',
      proxyUrl: PROXY_URL,
      instanceUrls: INSTANCE_URLS,
      jobs,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should not reject any jobs immediately', () => {
    // No job should have status 'failed' - all should complete or be queued
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(0);
  });

  it('should eventually complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(NUM_JOBS);
  });

  it('should show jobs waiting in snapshots when rate limit is reached', () => {
    // Check that some snapshot shows activeJobs > 0 (jobs waiting/processing)
    const snapshotsWithActiveJobs = data.snapshots.filter((s) =>
      Object.values(s.instances).some((inst) => inst.activeJobs > 0)
    );
    expect(snapshotsWithActiveJobs.length).toBeGreaterThan(0);
  });

  it('should record all job lifecycle events', () => {
    // Each job should have queued, started, and completed events
    for (const job of Object.values(data.jobs)) {
      const hasQueued = job.events.some((e) => e.type === 'queued');
      const hasStarted = job.events.some((e) => e.type === 'started');
      const hasCompleted = job.events.some((e) => e.type === 'completed');

      expect(hasQueued).toBe(true);
      expect(hasStarted).toBe(true);
      expect(hasCompleted).toBe(true);
    }
  });
});
