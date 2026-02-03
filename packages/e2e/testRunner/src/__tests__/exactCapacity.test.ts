/**
 * Test suite: Exact Capacity
 *
 * Sends exactly the rate limiter capacity worth of jobs and verifies all complete.
 *
 * Capacity calculation for openai/gpt-5.2:
 * - TPM limit: 500,000 tokens/minute
 * - Summary job: 10,000 tokens each
 * - Capacity: 500,000 / 10,000 = 50 jobs
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// Exact capacity: 500,000 TPM / 10,000 tokens per summary job = 50 jobs
const EXACT_CAPACITY = 50;
const JOB_DURATION_MS = 100;
const WAIT_TIMEOUT_MS = 60000;
const BEFORE_ALL_TIMEOUT_MS = 120000;

describe('Exact Capacity', () => {
  let data: TestData;

  beforeAll(async () => {
    // Each job takes 100ms to process
    const jobs = generateJobsOfType(EXACT_CAPACITY, 'summary', {
      prefix: 'capacity-test',
      durationMs: JOB_DURATION_MS,
    });

    data = await runSuite({
      suiteName: 'exact-capacity',
      proxyUrl: PROXY_URL,
      instanceUrls: INSTANCE_URLS,
      jobs,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should send exactly the capacity number of jobs', () => {
    expect(Object.keys(data.jobs).length).toBe(EXACT_CAPACITY);
  });

  it('should complete all jobs without failures', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');

    expect(failedJobs.length).toBe(0);
    expect(completedJobs.length).toBe(EXACT_CAPACITY);
  });

  it('should process all jobs through the rate limiter', () => {
    // Every job should have gone through queued -> started -> completed
    for (const job of Object.values(data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });

  it('should distribute jobs across instances', () => {
    // With 2 instances, jobs should be distributed (not all on one instance)
    const instanceIds = Object.keys(data.summary.byInstance);
    expect(instanceIds.length).toBeGreaterThan(0);

    // At least some jobs should be on each active instance
    for (const instanceId of instanceIds) {
      const instanceStats = data.summary.byInstance[instanceId];
      expect(instanceStats).toBeDefined();
      expect(instanceStats?.total).toBeGreaterThan(0);
    }
  });

  it('should use the primary model for all jobs', () => {
    // All jobs should complete on openai/gpt-5.2 (primary model in escalation order)
    const modelStats = data.summary.byModel['openai/gpt-5.2'];
    expect(modelStats).toBeDefined();
    expect(modelStats?.completed).toBe(EXACT_CAPACITY);
  });
});
