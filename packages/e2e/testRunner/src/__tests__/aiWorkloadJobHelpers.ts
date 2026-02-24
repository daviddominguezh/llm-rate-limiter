/**
 * Job submission, result polling, and data collection helpers for AI Workload test.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StateAggregator } from '../stateAggregator.js';
import { type JobEvent, TestDataCollector } from '../testDataCollector.js';
import { sleep } from '../testUtils.js';
import { HTTP_OK } from './aiWorkloadHelpers.js';

// ---- Module-level collector ----
let activeCollector: TestDataCollector | null = null;

/** Set the active data collector for recording job submissions */
export const setActiveCollector = (collector: TestDataCollector | null): void => {
  activeCollector = collector;
};

// ---- Polling constants ----
const POLL_INTERVAL_MS = 100;
const JOB_COMPLETE_TIMEOUT_MS = 60000;
const SNAPSHOT_INTERVAL_MS = 500;
const JSON_INDENT_SPACES = 2;

// ---- Job duration ranges (random per job, as specified) ----
export const SUMMARIZE_MIN_DURATION_MS = 20000;
export const SUMMARIZE_MAX_DURATION_MS = 35000;

/** Generate a random integer duration between min and max (inclusive) */
export const randomDurationMs = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// ---- Types ----

/** Job payload for submission */
export interface JobPayload {
  durationMs: number;
}

/** Job result response from debug endpoint */
export interface JobResultResponse {
  jobId: string;
  status: string;
  modelUsed?: string;
  queueDuration?: number;
}

/** Data collection context for a test run */
export interface DataCollectionContext {
  collector: TestDataCollector;
  aggregator: StateAggregator;
  stopPeriodicSnapshots: () => void;
}

// ---- Type guards ----

/** Type guard for JobResultResponse */
const isJobResult = (value: unknown): value is JobResultResponse =>
  typeof value === 'object' && value !== null && 'jobId' in value && 'status' in value;

// ---- Job submission ----

/** Submit a job to an instance and record in the active collector */
export const submitJob = async (
  port: number,
  jobId: string,
  jobType: string,
  payload: JobPayload
): Promise<number> => {
  const targetUrl = `http://localhost:${String(port)}`;
  activeCollector?.recordJobSent(jobId, jobType, targetUrl);
  const response = await fetch(`${targetUrl}/api/queue-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, jobType, payload }),
  });
  return response.status;
};

// ---- Job result polling ----

/** Try to fetch a job result from an instance */
const tryFetchJobResult = async (port: number, jobId: string): Promise<JobResultResponse | null> => {
  try {
    const url = `http://localhost:${port}/api/debug/job-result/${jobId}`;
    const response = await fetch(url);
    if (response.status !== HTTP_OK) return null;
    const data: unknown = await response.json();
    return isJobResult(data) ? data : null;
  } catch {
    return null;
  }
};

/** Poll for job result with timeout */
const pollJobResult = async (
  port: number,
  jobId: string,
  startTime: number,
  timeoutMs: number
): Promise<JobResultResponse | null> => {
  if (Date.now() - startTime >= timeoutMs) return null;
  const result = await tryFetchJobResult(port, jobId);
  if (result !== null) return result;
  await sleep(POLL_INTERVAL_MS);
  return await pollJobResult(port, jobId, startTime, timeoutMs);
};

/** Wait for job result with timeout */
export const waitForJobResult = async (
  port: number,
  jobId: string,
  timeoutMs = JOB_COMPLETE_TIMEOUT_MS
): Promise<JobResultResponse> => {
  const result = await pollJobResult(port, jobId, Date.now(), timeoutMs);
  if (result === null) {
    throw new Error(`Timeout waiting for job result: ${jobId}`);
  }
  return result;
};

// ---- Data collection ----

/** Get the output directory for test result data */
const getOutputDir = (): string => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, '../../../testResults/src/data');
};

/** Build output file path for a suite name */
const getOutputPath = (suiteName: string): string => join(getOutputDir(), `${suiteName}.json`);

/** Create event-triggered snapshot handler */
const createEventSnapshotHandler =
  (
    aggregator: StateAggregator,
    collectorRef: { current: TestDataCollector | null }
  ): ((event: JobEvent) => void) =>
  (event: JobEvent): void => {
    if (collectorRef.current === null) return;
    const { current: collector } = collectorRef;
    aggregator
      .fetchState()
      .then((states) => {
        collector.addSnapshot(`${event.type}:${event.jobId}`, states);
      })
      .catch(() => {
        // Ignore snapshot errors during rapid event processing
      });
  };

/** Start periodic snapshot polling, returns a stop function */
const startPeriodicSnapshots = (
  aggregator: StateAggregator,
  collector: TestDataCollector,
  intervalMs: number
): { stop: () => void } => {
  const intervalId = setInterval(() => {
    aggregator
      .fetchState()
      .then((states) => {
        collector.addSnapshot('periodic', states);
      })
      .catch(() => {
        // Ignore periodic snapshot errors
      });
  }, intervalMs);
  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
};

/** Create data collection context */
export const createDataCollection = (instanceUrls: string[]): DataCollectionContext => {
  const aggregator = new StateAggregator(instanceUrls);
  const collectorRef: { current: TestDataCollector | null } = { current: null };
  const onJobEvent = createEventSnapshotHandler(aggregator, collectorRef);
  const collector = new TestDataCollector(instanceUrls, { onJobEvent });
  collectorRef.current = collector;
  const periodic = startPeriodicSnapshots(aggregator, collector, SNAPSHOT_INTERVAL_MS);
  return { collector, aggregator, stopPeriodicSnapshots: periodic.stop };
};

/** Start data collection: SSE listeners + initial snapshot */
export const startDataCollection = async (ctx: DataCollectionContext): Promise<void> => {
  await ctx.collector.startEventListeners();
  const states = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot('initial', states);
};

/** Add a labeled snapshot to the collector */
export const addSnapshot = async (ctx: DataCollectionContext, label: string): Promise<void> => {
  const states = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot(label, states);
};

/** Stop collection and save to JSON file */
export const saveAndStopCollection = async (ctx: DataCollectionContext, suiteName: string): Promise<void> => {
  ctx.stopPeriodicSnapshots();
  const finalStates = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot('final', finalStates);
  ctx.collector.stopEventListeners();
  const filePath = getOutputPath(suiteName);
  await mkdir(dirname(filePath), { recursive: true });
  const data = ctx.collector.getData();
  const json = JSON.stringify(data, null, JSON_INDENT_SPACES);
  await writeFile(filePath, json, 'utf-8');
};
