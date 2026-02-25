/**
 * Structured capacity transform.
 *
 * Converts raw TestData into a clean nested structure:
 *   interval → instance → model → jobType → { running, queued, capacity }
 *
 * Designed for debugging, scripting, and as the single source of truth
 * for all capacity visualization.
 */
import type {
  CompactInstanceState,
  CompactModelJobTypeState,
  JobRecord,
  StateSnapshot,
  TestData,
} from '@llm-rate-limiter/e2e-test-results';

import { buildCapacitySetup } from './structuredTransformSetup';
import type { CapacitySetup, ModelWeights } from './structuredTransformSetup';

// =============================================================================
// Public types
// =============================================================================

export interface JobTypeMetrics {
  running: number;
  queued: number;
  capacity: number;
  /** running * per-model job type weight */
  runningHeight: number;
  /** capacity * per-model job type weight */
  capacityHeight: number;
  /** Raw pool-allocated slots (before inflation to cover in-flight) */
  slots: number;
}

type JobTypeMap = Record<string, JobTypeMetrics>;
type ModelMap = Record<string, JobTypeMap>;
type InstanceMap = Record<string, ModelMap>;

export interface CapacityInterval {
  /** Seconds from test start */
  time: number;
  /** Absolute timestamp in milliseconds */
  timestamp: number;
  /** Per-instance capacity data */
  instances: InstanceMap;
}

export type { CapacitySetup, JobTypeSetup, ModelSetup, ModelWeights } from './structuredTransformSetup';

export interface StructuredCapacityResult {
  setup: CapacitySetup;
  data: CapacityInterval[];
}

// =============================================================================
// Constants
// =============================================================================

const NUM_INTERVALS = 400;
const MS_TO_SECONDS = 1000;
const HALF = 2;

// =============================================================================
// Helpers
// =============================================================================

/** Map full instance UUIDs to short IDs like "inst1" */
function buildInstanceIdMap(testData: TestData): Map<string, string> {
  const map = new Map<string, string>();
  Object.values(testData.metadata.instances).forEach((id, i) => {
    map.set(id, `inst${i + 1}`);
  });
  return map;
}

/** Derive time span from job activity and test metadata */
function findTimeSpan(testData: TestData): { minTime: number; maxTime: number } {
  const jobs = Object.values(testData.jobs);
  if (jobs.length === 0) {
    return { minTime: testData.metadata.startTime, maxTime: testData.metadata.endTime };
  }
  const minTime = jobs.reduce((min, j) => Math.min(min, j.sentAt), Infinity);
  const lastEventTime = (j: JobRecord): number => j.events[j.events.length - 1]?.timestamp ?? 0;
  const jobMaxTime = jobs.reduce((max, j) => Math.max(max, lastEventTime(j)), 0);
  return { minTime, maxTime: Math.max(jobMaxTime, testData.metadata.endTime) };
}

/** Find the most recent snapshot at or before a timestamp */
function snapshotAt(snapshots: StateSnapshot[], timestamp: number): StateSnapshot | null {
  let result: StateSnapshot | null = null;
  for (const snap of snapshots) {
    if (snap.timestamp <= timestamp) result = snap;
    else break;
  }
  return result;
}

/** Count active (submitted but not finished) jobs by jobType */
function countActiveByType(activeJobIds: string[], jobs: Record<string, JobRecord>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const jobId of activeJobIds) {
    const job = jobs[jobId];
    if (job !== undefined) {
      counts[job.jobType] = (counts[job.jobType] ?? 0) + 1;
    }
  }
  return counts;
}

/** Build metrics for a single (model, jobType) entry */
function toMetrics(jt: CompactModelJobTypeState, weight: number): JobTypeMetrics {
  const running = jt.inFlight;
  const capacity = Math.max(jt.totalSlots, running);
  return {
    running,
    queued: 0,
    capacity,
    runningHeight: running,
    capacityHeight: capacity,
    slots: jt.slots,
  };
}

/** Build model → jobType → metrics from one instance's snapshot state */
function buildModelMap(
  state: CompactInstanceState,
  jobs: Record<string, JobRecord>,
  modelWeights: ModelWeights
): ModelMap {
  const models: ModelMap = {};
  const defaultWeight = 1;

  for (const [modelId, ms] of Object.entries(state.models)) {
    if (ms.jobTypes === undefined) continue;
    const jtMap: JobTypeMap = {};
    const mWeights = modelWeights[modelId] ?? {};
    for (const [jt, jtState] of Object.entries(ms.jobTypes)) {
      jtMap[jt] = toMetrics(jtState, mWeights[jt] ?? defaultWeight);
    }
    models[modelId] = jtMap;
  }

  attributeQueued(models, countActiveByType(state.activeJobIds, jobs));
  return models;
}

/** Attribute queued jobs to the bottleneck model per jobType */
function attributeQueued(models: ModelMap, activeByType: Record<string, number>): void {
  for (const [jobType, activeCount] of Object.entries(activeByType)) {
    const { totalRunning, bottleneck } = findBottleneck(models, jobType);
    const queued = Math.max(0, activeCount - totalRunning);
    if (queued > 0 && bottleneck !== undefined) {
      bottleneck.queued = queued;
    }
  }
}

/** Find the bottleneck model (highest utilization) for a job type */
function findBottleneck(
  models: ModelMap,
  jobType: string
): { totalRunning: number; bottleneck: JobTypeMetrics | undefined } {
  let totalRunning = 0;
  let bottleneck: JobTypeMetrics | undefined;
  let highestRatio = -1;

  for (const jtMap of Object.values(models)) {
    const jt = jtMap[jobType];
    if (jt === undefined) continue;
    totalRunning += jt.running;
    const ratio = jt.capacity > 0 ? jt.running / jt.capacity : 0;
    if (ratio > highestRatio) {
      highestRatio = ratio;
      bottleneck = jt;
    }
  }

  return { totalRunning, bottleneck };
}

/** Build a reverse mapping: shortId → fullId */
export function buildInstanceFullIdMap(testData: TestData): Record<string, string> {
  const reverse: Record<string, string> = {};
  Object.values(testData.metadata.instances).forEach((id, i) => {
    reverse[`inst${i + 1}`] = id;
  });
  return reverse;
}

// =============================================================================
// Main transform
// =============================================================================

/** Transform TestData into a structured result with setup and data */
export function transformToStructuredData(testData: TestData): StructuredCapacityResult {
  const { setup, modelWeights } = buildCapacitySetup(
    testData.metadata.instances,
    testData.metadata.modelCapacities,
    testData.metadata.jobTypeResources
  );
  const idMap = buildInstanceIdMap(testData);
  const { minTime, maxTime } = findTimeSpan(testData);
  const intervalMs = (maxTime - minTime) / NUM_INTERVALS;
  const data: CapacityInterval[] = [];

  for (let i = 0; i < NUM_INTERVALS; i += 1) {
    const mid = minTime + i * intervalMs + intervalMs / HALF;
    const snapshot = snapshotAt(testData.snapshots, mid);
    const instances: InstanceMap = {};

    if (snapshot !== null) {
      for (const [fullId, state] of Object.entries(snapshot.instances)) {
        const shortId = idMap.get(fullId) ?? fullId;
        instances[shortId] = buildModelMap(state, testData.jobs, modelWeights);
      }
    }

    data.push({
      time: Math.round(((mid - minTime) / MS_TO_SECONDS) * 100) / 100,
      timestamp: mid,
      instances,
    });
  }

  return { setup, data };
}
