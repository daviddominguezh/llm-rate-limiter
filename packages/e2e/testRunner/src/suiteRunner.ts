import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ConfigPresetName, resetInstance } from './resetInstance.js';
import { StateAggregator } from './stateAggregator.js';
import { TestDataCollector } from './testDataCollector.js';
import { sendJob, sleep } from './testUtils.js';

const ZERO = 0;
const SLEEP_AFTER_SEND_MS = 200;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Configuration for a test suite run */
export interface SuiteConfig {
  /** Name of the test suite (used for output file name) */
  suiteName: string;
  /** URL of the proxy server */
  proxyUrl: string;
  /** URLs of the server instances */
  instanceUrls: string[];
  /** Jobs to send during this suite */
  jobs: Array<{ jobId: string; jobType: string; payload: Record<string, unknown> }>;
  /** Timeout for waiting for jobs to complete (default: 30000ms) */
  waitTimeoutMs?: number;
  /** Whether to save the test data to a file (default: true) */
  saveToFile?: boolean;
  /**
   * Distribution ratio for the proxy (e.g., "26:25" for 26 jobs to first instance, 25 to second).
   * If not set, uses equal distribution.
   */
  proxyRatio?: string;
  /**
   * Wait until the next minute boundary (00 seconds) before sending jobs.
   * This ensures deterministic maxWaitMS calculations. Default: false.
   */
  waitForMinuteBoundary?: boolean;
  /**
   * Send all jobs in parallel instead of sequentially.
   * This ensures all jobs arrive at the same time. Default: false.
   */
  sendJobsInParallel?: boolean;
  /**
   * Jobs to send after a delay (for escalation tests).
   * These jobs are sent after the main jobs have been registered.
   */
  delayedJobs?: Array<{ jobId: string; jobType: string; payload: Record<string, unknown> }>;
  /**
   * Delay in ms before sending delayedJobs. Default: 500ms.
   */
  delayedJobsDelayMs?: number;
  /**
   * Configuration preset to use for the instances.
   * If not set, uses 'default' preset.
   */
  configPreset?: ConfigPresetName;
}

/** Get the directory of this module */
const getCurrentDir = (): string => dirname(fileURLToPath(import.meta.url));

/** Get the default output directory for test results */
const getOutputDir = (): string => join(getCurrentDir(), '../../testResults/src/data');

/** Generate output file path for a suite */
const getOutputPath = (suiteName: string): string => {
  return join(getOutputDir(), `${suiteName}.json`);
};

/** Delay to allow distributed allocation to propagate after instance registration */
const ALLOCATION_PROPAGATION_DELAY_MS = 500;

/**
 * Wait until the next minute boundary (00 seconds).
 * This ensures deterministic maxWaitMS calculations in tests.
 */
const waitUntilNextMinute = async (): Promise<void> => {
  const now = new Date();
  const secondsUntilNextMinute = SECONDS_PER_MINUTE - now.getSeconds();
  const msUntilNextMinute = secondsUntilNextMinute * MS_PER_SECOND - now.getMilliseconds();
  if (msUntilNextMinute > ZERO) {
    console.log(`[Suite] Waiting ${msUntilNextMinute}ms until next minute boundary...`);
    await sleep(msUntilNextMinute);
    console.log(`[Suite] Minute boundary reached, proceeding...`);
  }
};

/** Reset proxy job counts */
const resetProxy = async (proxyUrl: string): Promise<void> => {
  const response = await fetch(`${proxyUrl}/proxy/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to reset proxy: ${response.statusText}`);
  }
};

/** Set proxy distribution ratio */
const setProxyRatio = async (proxyUrl: string, ratio: string): Promise<void> => {
  const response = await fetch(`${proxyUrl}/proxy/ratio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ratio }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set proxy ratio: ${response.statusText}`);
  }
};

/** Reset all server instances */
const resetAllInstances = async (instanceUrls: string[], configPreset?: ConfigPresetName): Promise<void> => {
  let isFirst = true;
  for (const url of instanceUrls) {
    const result = await resetInstance(url, { cleanRedis: isFirst, configPreset });
    if (!result.success) {
      throw new Error(`Failed to reset instance ${url}: ${result.error}`);
    }
    isFirst = false;
  }
  // Wait for distributed allocation to propagate to all instances
  await sleep(ALLOCATION_PROPAGATION_DELAY_MS);
};

/**
 * Run a test suite: reset instances, send jobs, collect data, return TestData.
 * This is the core function used by all E2E test suites.
 */
export const runSuite = async (config: SuiteConfig): Promise<TestData> => {
  const {
    suiteName,
    proxyUrl,
    instanceUrls,
    jobs,
    waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
    saveToFile = true,
    proxyRatio,
    waitForMinuteBoundary = false,
    sendJobsInParallel = false,
    delayedJobs = [],
    delayedJobsDelayMs = 500,
    configPreset,
  } = config;

  // 1. Reset proxy and optionally set distribution ratio
  await resetProxy(proxyUrl);
  if (proxyRatio !== undefined) {
    await setProxyRatio(proxyUrl, proxyRatio);
  }

  // 2. Reset all instances (cleanRedis: true on first only)
  await resetAllInstances(instanceUrls, configPreset);

  // 3. Create StateAggregator + TestDataCollector
  const aggregator = new StateAggregator(instanceUrls);
  const collector = new TestDataCollector(instanceUrls, {
    onJobEvent: (event) => {
      // Take a snapshot asynchronously when a job event occurs
      aggregator
        .fetchState()
        .then((states) => {
          collector.addSnapshot(`${event.type}:${event.jobId}`, states);
        })
        .catch(() => {
          // Ignore snapshot errors
        });
    },
  });

  // 4. Start SSE listeners
  await collector.startEventListeners();

  // 5. Take initial snapshot
  const initialStates = await aggregator.fetchState();
  collector.addSnapshot('initial', initialStates);

  // 6. Optionally wait for minute boundary
  if (waitForMinuteBoundary) {
    await waitUntilNextMinute();
  }

  // 7. Send all jobs (sequentially or in parallel)
  if (sendJobsInParallel) {
    // Record all jobs as sent first
    for (const job of jobs) {
      collector.recordJobSent(job.jobId, job.jobType, proxyUrl);
    }
    // Send all jobs in parallel
    await Promise.all(jobs.map((job) => sendJob(proxyUrl, job)));
  } else {
    // Send jobs sequentially
    for (const job of jobs) {
      collector.recordJobSent(job.jobId, job.jobType, proxyUrl);
      await sendJob(proxyUrl, job);
    }
  }

  // 7b. Send delayed jobs (for escalation tests - ensures they arrive after main jobs are queued)
  if (delayedJobs.length > ZERO) {
    await sleep(delayedJobsDelayMs);
    for (const job of delayedJobs) {
      collector.recordJobSent(job.jobId, job.jobType, proxyUrl);
    }
    await Promise.all(delayedJobs.map((job) => sendJob(proxyUrl, job)));
  }

  // 8. Take post-send snapshot
  await sleep(SLEEP_AFTER_SEND_MS);
  const afterSendStates = await aggregator.fetchState();
  collector.addSnapshot('after-sending-jobs', afterSendStates);

  // 9. Wait for jobs to complete
  try {
    await aggregator.waitForNoActiveJobs({ timeoutMs: waitTimeoutMs });
  } catch {
    // Timeout is not fatal - we still want to collect the data
  }

  // 10. Take final snapshot
  const finalStates = await aggregator.fetchState();
  collector.addSnapshot('final', finalStates);

  // 11. Stop listeners
  collector.stopEventListeners();

  // 12. Get the collected data
  const data = collector.getData();

  // 13. Optionally save to file
  if (saveToFile) {
    const filePath = getOutputPath(suiteName);
    await mkdir(dirname(filePath), { recursive: true });
    await collector.saveToFile(filePath);
  }

  return data;
};

/** Available job types for random generation */
export const JOB_TYPES = [
  'summary',
  'VacationPlanning',
  'ImageCreation',
  'BudgetCalculation',
  'WeatherForecast',
] as const;

/** Generate a random job type */
export const getRandomJobType = (): string => {
  const randomIndex = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[randomIndex] ?? 'summary';
};

/** Options for job generation */
export interface JobGenerationOptions {
  /** Prefix for job IDs */
  prefix?: string;
  /** Duration in ms for each job to simulate processing time */
  durationMs?: number;
}

/** Generated job structure */
export interface GeneratedJob {
  jobId: string;
  jobType: string;
  payload: { testData: string; durationMs?: number };
}

/** Generate a list of random jobs */
export const generateRandomJobs = (count: number, options: JobGenerationOptions = {}): GeneratedJob[] => {
  const { prefix = 'test-job', durationMs } = options;
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    jobId: `${prefix}-${timestamp}-${i}`,
    jobType: getRandomJobType(),
    payload: {
      testData: `Test payload for job ${i}`,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  }));
};

/** Generate jobs with a specific type */
export const generateJobsOfType = (
  count: number,
  jobType: string,
  options: JobGenerationOptions = {}
): GeneratedJob[] => {
  const { prefix = 'test-job', durationMs } = options;
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    jobId: `${prefix}-${timestamp}-${i}`,
    jobType,
    payload: {
      testData: `Test payload for job ${i}`,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  }));
};
