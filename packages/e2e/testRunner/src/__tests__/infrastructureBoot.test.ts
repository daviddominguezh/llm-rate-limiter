/**
 * Test suite: Infrastructure Boot
 *
 * Simple smoke test that verifies we can boot the e2e setup programmatically:
 * - Boot two server instances
 * - Boot the proxy
 * - Send a few jobs
 * - Verify jobs complete
 * - Clean up
 *
 * This test validates the infrastructure works, not rate limiter behavior.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';
import { createEmptyTestData } from './testHelpers.js';

const PROXY_PORT = 3000;
const INSTANCE_PORT_1 = 3001;
const INSTANCE_PORT_2 = 3002;
const PROXY_URL = `http://localhost:${PROXY_PORT}`;
const INSTANCE_URLS = [`http://localhost:${INSTANCE_PORT_1}`, `http://localhost:${INSTANCE_PORT_2}`];

const NUM_JOBS = 5;
const JOB_DURATION_MS = 50;
const WAIT_TIMEOUT_MS = 30000;
const BEFORE_ALL_TIMEOUT_MS = 60000;
const AFTER_ALL_TIMEOUT_MS = 30000;

const ZERO_COUNT = 0;

/** Boot all infrastructure components */
const bootInfrastructure = async (): Promise<void> => {
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_1, 'default');
  await bootInstance(INSTANCE_PORT_2, 'default');
  await bootProxy([INSTANCE_PORT_1, INSTANCE_PORT_2], PROXY_PORT);
};

/** Tear down all infrastructure components */
const teardownInfrastructure = async (): Promise<void> => {
  try {
    await killProxy();
  } catch {
    // Proxy may not have started
  }
  try {
    await killAllInstances();
  } catch {
    // Instances may not have started
  }
};

/** Setup test data by running the suite */
const setupTestData = async (): Promise<TestData> => {
  const jobs = generateJobsOfType(NUM_JOBS, 'summary', {
    prefix: 'infra-boot',
    durationMs: JOB_DURATION_MS,
  });

  return await runSuite({
    suiteName: 'infrastructure-boot',
    proxyUrl: PROXY_URL,
    instanceUrls: INSTANCE_URLS,
    jobs,
    waitTimeoutMs: WAIT_TIMEOUT_MS,
    proxyRatio: '1:1',
    saveToFile: false,
  });
};

describe('Infrastructure Boot', () => {
  let data: TestData = createEmptyTestData();

  beforeAll(async () => {
    await bootInfrastructure();
    data = await setupTestData();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await teardownInfrastructure();
  }, AFTER_ALL_TIMEOUT_MS);

  it('should boot instances successfully', () => {
    expect(data.metadata.instances).toBeDefined();
  });

  it('should send jobs through the proxy', () => {
    expect(Object.keys(data.jobs).length).toBe(NUM_JOBS);
  });

  it('should complete all jobs without failures', () => {
    const completedJobs = Object.values(data.jobs).filter((j) => j.status === 'completed');
    const failedJobs = Object.values(data.jobs).filter((j) => j.status === 'failed');
    expect(failedJobs.length).toBe(ZERO_COUNT);
    expect(completedJobs.length).toBe(NUM_JOBS);
  });

  it('should process jobs through the rate limiter', () => {
    for (const job of Object.values(data.jobs)) {
      expect(job.events.some((e) => e.type === 'queued')).toBe(true);
      expect(job.events.some((e) => e.type === 'started')).toBe(true);
      expect(job.events.some((e) => e.type === 'completed')).toBe(true);
    }
  });

  it('should distribute jobs across instances', () => {
    const instanceIds = Object.keys(data.summary.byInstance);
    expect(instanceIds.length).toBeGreaterThan(ZERO_COUNT);
  });
});
