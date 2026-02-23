/**
 * Job submission, result polling, and payload factories for mega comprehensive test.
 */
import type { TestDataCollector } from '../testDataCollector.js';
import { sleep } from '../testUtils.js';
import { HTTP_OK } from './megaComprehensiveHelpers.js';

// Module-level collector for recording job submissions
let activeCollector: TestDataCollector | null = null;

/** Set the active data collector for job recording. Pass null to clear. */
export const setActiveCollector = (collector: TestDataCollector | null): void => {
  activeCollector = collector;
};

// Polling constants
const POLL_INTERVAL_MS = 100;
const JOB_COMPLETE_TIMEOUT_MS = 60000;

// Job durations
export const SHORT_JOB_DURATION_MS = 1000;
export const MEDIUM_JOB_DURATION_MS = 3000;
export const LONG_JOB_DURATION_MS = 5000;
export const TIME_WINDOW_JOB_DURATION_MS = 10000;

// Zero token values
const ZERO_TOKENS = 0;
const ZERO_REQUESTS = 0;
const SINGLE_REQUEST = 1;

// Refund payload: actual < estimated (3000 + 2000 = 5000 < 10000 estimated)
const REFUND_INPUT_TOKENS = 3000;
const REFUND_OUTPUT_TOKENS = 2000;

// Overage payload: actual > estimated (12000 + 5000 = 17000 > 10000 estimated)
const OVERAGE_INPUT_TOKENS = 12000;
const OVERAGE_OUTPUT_TOKENS = 5000;

// Token breakdown: input + output + cached
const BREAKDOWN_INPUT_TOKENS = 3000;
const BREAKDOWN_OUTPUT_TOKENS = 2000;
const BREAKDOWN_CACHED_TOKENS = 1000;

// Reject usage: partial usage reported on failure
const REJECT_INPUT_TOKENS = 2000;
const REJECT_OUTPUT_TOKENS = 1000;

/** Job payload for submission */
export interface JobPayload {
  durationMs: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  actualCachedTokens?: number;
  actualRequestCount?: number;
  shouldThrow?: boolean;
  shouldReject?: boolean;
  rejectUsage?: RejectUsagePayload;
}

/** Reject usage payload shape */
interface RejectUsagePayload {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requestCount: number;
}

/** Job result response from debug endpoint */
export interface JobResultResponse {
  jobId: string;
  status: string;
  modelUsed?: string;
  queueDuration?: number;
  executionDuration?: number;
  error?: string;
}

/** Type guard for JobResultResponse */
const isJobResult = (value: unknown): value is JobResultResponse =>
  typeof value === 'object' && value !== null && 'jobId' in value && 'status' in value;

/** Submit a job to a specific port and record it in the active collector */
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

/** Try to fetch a job result from an instance */
const tryFetchJobResult = async (port: number, jobId: string): Promise<JobResultResponse | null> => {
  try {
    const response = await fetch(`http://localhost:${port}/api/debug/job-result/${jobId}`);
    if (response.status !== HTTP_OK) {
      return null;
    }
    const data: unknown = await response.json();
    return isJobResult(data) ? data : null;
  } catch {
    return null;
  }
};

/** Poll for job result recursively */
const pollJobResult = async (
  port: number,
  jobId: string,
  startTime: number,
  timeoutMs: number
): Promise<JobResultResponse | null> => {
  if (Date.now() - startTime >= timeoutMs) {
    return null;
  }
  const result = await tryFetchJobResult(port, jobId);
  if (result !== null) {
    return result;
  }
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

// ---- Payload Factories ----

/** Standard job: uses default actual tokens (7000 in + 3000 out = 10000) */
export const standardPayload = (durationMs = MEDIUM_JOB_DURATION_MS): JobPayload => ({
  durationMs,
});

/** Zero token job: no capacity consumed */
export const zeroTokenPayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  actualInputTokens: ZERO_TOKENS,
  actualOutputTokens: ZERO_TOKENS,
  actualCachedTokens: ZERO_TOKENS,
  actualRequestCount: ZERO_REQUESTS,
});

/** Refund job: actual < estimated */
export const refundPayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  actualInputTokens: REFUND_INPUT_TOKENS,
  actualOutputTokens: REFUND_OUTPUT_TOKENS,
});

/** Overage job: actual > estimated */
export const overagePayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  actualInputTokens: OVERAGE_INPUT_TOKENS,
  actualOutputTokens: OVERAGE_OUTPUT_TOKENS,
});

/** Token breakdown job: input + output + cached */
export const tokenBreakdownPayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  actualInputTokens: BREAKDOWN_INPUT_TOKENS,
  actualOutputTokens: BREAKDOWN_OUTPUT_TOKENS,
  actualCachedTokens: BREAKDOWN_CACHED_TOKENS,
});

/** Throw job: throws without calling reject */
export const throwPayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  shouldThrow: true,
});

/** Reject job: calls reject() with custom usage, triggering rate limiter rejection */
export const rejectPayload = (durationMs = SHORT_JOB_DURATION_MS): JobPayload => ({
  durationMs,
  shouldReject: true,
  rejectUsage: {
    inputTokens: REJECT_INPUT_TOKENS,
    outputTokens: REJECT_OUTPUT_TOKENS,
    cachedTokens: ZERO_TOKENS,
    requestCount: SINGLE_REQUEST,
  },
});

/** Fetch stats from debug endpoint */
export const fetchStats = async (port: number): Promise<unknown> => {
  const response = await fetch(`http://localhost:${port}/api/debug/stats`);
  const data: unknown = await response.json();
  return data;
};

/** Fetch overages from debug endpoint */
export const fetchOverages = async (port: number): Promise<unknown> => {
  const response = await fetch(`http://localhost:${port}/api/debug/overages`);
  const data: unknown = await response.json();
  return data;
};
