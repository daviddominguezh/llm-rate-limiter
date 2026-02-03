/**
 * Test suite: Model Escalation on maxWaitMS Timeout
 *
 * Verifies that when a job's maxWaitMS expires on the primary model,
 * it escalates to the next model in the escalation order.
 *
 * Configuration:
 * - Fill primary model (openai/gpt-5.2) to capacity with 50 summary jobs
 * - Send 1 escalationTest job with short maxWaitMS (2 seconds) for primary model
 * - The escalationTest job should timeout on primary and escalate to secondary (xai/grok-4.1-fast)
 *
 * Expected behavior:
 * - 50 summary jobs complete on openai/gpt-5.2
 * - 1 escalationTest job waits ~2 seconds, then escalates to xai/grok-4.1-fast
 * - All jobs complete successfully (no rejections)
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];

// Fill capacity with summary jobs: 500,000 TPM / 10,000 tokens = 50 jobs
const CAPACITY_JOBS = 50;
const JOB_DURATION_MS = 100;

// The escalationTest job type has maxWaitMS of 2000ms for openai/gpt-5.2
const ESCALATION_TIMEOUT_MS = 2000;
const TOLERANCE_MS = 500;

const WAIT_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;

describe('Model Escalation on maxWaitMS Timeout', () => {
  let data: TestData;

  beforeAll(async () => {
    // First, create capacity-filling jobs (summary type)
    const capacityJobs = generateJobsOfType(CAPACITY_JOBS, 'summary', {
      prefix: 'escalation-capacity',
      durationMs: JOB_DURATION_MS,
    });

    // Then, create the escalation test job
    const escalationJob = {
      jobId: `escalation-test-${Date.now()}`,
      jobType: 'escalationTest',
      payload: { testData: 'Escalation test job', durationMs: JOB_DURATION_MS },
    };

    // Combine all jobs - capacity jobs first, then the escalation test job
    const allJobs = [...capacityJobs, escalationJob];

    data = await runSuite({
      suiteName: 'model-escalation',
      proxyUrl: PROXY_URL,
      instanceUrls: INSTANCE_URLS,
      jobs: allJobs,
      waitTimeoutMs: WAIT_TIMEOUT_MS,
      proxyRatio: '1:1',
    });
  }, BEFORE_ALL_TIMEOUT_MS);

  it('should send all jobs', () => {
    expect(Object.keys(data.jobs).length).toBe(CAPACITY_JOBS + 1);
  });

  it('should not reject any jobs', () => {
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(0);
  });

  it('should complete all jobs', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    expect(completedJobs.length).toBe(CAPACITY_JOBS + 1);
  });

  it('should complete capacity jobs on the primary model', () => {
    // All summary jobs should complete on openai/gpt-5.2
    const summaryJobs = Object.values(data.jobs).filter((j) => j.jobType === 'summary');
    const summaryOnPrimary = summaryJobs.filter((j) => j.modelUsed === 'openai/gpt-5.2');

    // Most summary jobs should be on primary model
    expect(summaryOnPrimary.length).toBeGreaterThanOrEqual(CAPACITY_JOBS - 5);
  });

  it('should escalate the test job to the secondary model', () => {
    // The escalationTest job should complete on xai/grok-4.1-fast
    const escalationJob = Object.values(data.jobs).find((j) => j.jobType === 'escalationTest');
    expect(escalationJob).toBeDefined();
    expect(escalationJob?.modelUsed).toBe('xai/grok-4.1-fast');
  });

  it('should have the escalation job wait approximately maxWaitMS before escalating', () => {
    const escalationJob = Object.values(data.jobs).find((j) => j.jobType === 'escalationTest');
    expect(escalationJob).toBeDefined();

    const queueDuration = escalationJob?.queueDurationMs ?? 0;

    // The job should have waited at least close to the maxWaitMS timeout
    // Allow some tolerance for processing time
    expect(queueDuration).toBeGreaterThanOrEqual(ESCALATION_TIMEOUT_MS - TOLERANCE_MS);
    // But not too long (shouldn't wait for full minute reset)
    expect(queueDuration).toBeLessThan(ESCALATION_TIMEOUT_MS + WAIT_TIMEOUT_MS);
  });
});
