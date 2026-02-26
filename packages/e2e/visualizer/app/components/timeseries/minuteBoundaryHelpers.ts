/**
 * Minute boundary computation and per-model job usage windowing.
 */
import type { JobRecord, TestData } from '@llm-rate-limiter/e2e-test-results';

import type { JobTypeUsage, ModelJobUsage } from './resourceDashboardHelpers';

export interface MinuteBoundary {
  label: string;
  startSeconds: number;
  endSeconds: number;
  epochStartMs: number;
  epochEndMs: number;
}

const MS_PER_MINUTE = 60000;
const MS_TO_SEC = 1000;

/** Get the timestamp when a job started (consuming rate-limit capacity) */
function getJobStartedMs(job: JobRecord): number {
  const started = job.events.find((e) => e.type === 'started');
  return started?.timestamp ?? job.sentAt;
}

/** Build a set of epoch minutes that have at least one job starting in them */
function buildActiveMinutes(testData: TestData): Set<number> {
  const active = new Set<number>();
  for (const job of Object.values(testData.jobs)) {
    active.add(Math.floor(getJobStartedMs(job) / MS_PER_MINUTE));
  }
  return active;
}

/** Compute epoch-minute boundaries relative to test start time (only minutes with jobs) */
export function computeMinuteBoundaries(testData: TestData): MinuteBoundary[] {
  if (Object.keys(testData.jobs).length === 0) return [];

  const { startTime } = testData.metadata;
  const activeMinutes = buildActiveMinutes(testData);
  const sortedMinutes = [...activeMinutes].sort((a, b) => a - b);

  return sortedMinutes.map((m, idx) => {
    const epochStart = m * MS_PER_MINUTE;
    const epochEnd = epochStart + MS_PER_MINUTE;
    return {
      label: `Min ${idx + 1}`,
      startSeconds: (epochStart - startTime) / MS_TO_SEC,
      endSeconds: (epochEnd - startTime) / MS_TO_SEC,
      epochStartMs: epochStart,
      epochEndMs: epochEnd,
    };
  });
}

function isInWindow(job: JobRecord, boundary: MinuteBoundary): boolean {
  const startedMs = getJobStartedMs(job);
  return startedMs >= boundary.epochStartMs && startedMs < boundary.epochEndMs;
}

function addJobToUsage(result: JobTypeUsage, job: JobRecord): void {
  let tokens = 0;
  for (const entry of job.usage) {
    tokens += entry.inputTokens + entry.outputTokens;
  }
  result.jobCount[job.jobType] = (result.jobCount[job.jobType] ?? 0) + 1;
  result.tokenUsage[job.jobType] = (result.tokenUsage[job.jobType] ?? 0) + tokens;
  result.totalJobs += 1;
  result.totalTokens += tokens;
}

/** Compute per-model job usage for a list of jobs */
function groupJobsByModel(jobs: JobRecord[]): ModelJobUsage[] {
  const map = new Map<string, JobTypeUsage>();

  for (const job of jobs) {
    const modelId = job.modelUsed ?? 'unknown';
    let usage = map.get(modelId);
    if (!usage) {
      usage = { jobCount: {}, tokenUsage: {}, totalJobs: 0, totalTokens: 0 };
      map.set(modelId, usage);
    }
    addJobToUsage(usage, job);
  }

  return [...map.entries()].map(([modelId, usage]) => ({ modelId, usage }));
}

/** Compute per-model job usage for all jobs */
export function computeModelJobUsage(testData: TestData): ModelJobUsage[] {
  return groupJobsByModel(Object.values(testData.jobs));
}

/** Compute per-model job usage filtered to a specific epoch-minute window */
export function computeModelJobUsageForWindow(testData: TestData, boundary: MinuteBoundary): ModelJobUsage[] {
  const jobs = Object.values(testData.jobs).filter((job) => isInWindow(job, boundary));
  return groupJobsByModel(jobs);
}
