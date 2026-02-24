/**
 * Transform test data into capacity-based format for visualization.
 * Shows data per job type, per model, per instance.
 */
import type { JobRecord, StateSnapshot, TestData } from '@llm-rate-limiter/e2e-test-results';

import type { CapacityDataPoint, CapacityMetric, InstanceConfig } from './capacityTypes';

const FIRST_INSTANCE_INDEX = 1;
const KEY_REGEXP = /[^a-zA-Z0-9]/gu;
const NUM_INTERVALS = 400;
const MS_TO_SECONDS = 1000;

/** Build instance ID map */
function buildInstanceIdMap(testData: TestData): Map<string, string> {
  const map = new Map<string, string>();
  const instanceIds = Object.values(testData.metadata.instances);
  instanceIds.forEach((id, index) => {
    map.set(id, `inst${index + FIRST_INSTANCE_INDEX}`);
  });
  return map;
}

/** Find the time span from job activity bounds */
function findTimeSpan(testData: TestData): { minTime: number; maxTime: number } {
  const jobs = Object.values(testData.jobs);
  if (jobs.length === 0) {
    return { minTime: testData.metadata.startTime, maxTime: testData.metadata.endTime };
  }

  const minTime = jobs.reduce((min, j) => (j.sentAt < min ? j.sentAt : min), Infinity);
  const maxTime = jobs.reduce((max, j) => {
    const end = j.events[j.events.length - 1]?.timestamp ?? 0;
    return end > max ? end : max;
  }, 0);

  return { minTime, maxTime };
}

/** Find the snapshot that applies at a given timestamp */
function findSnapshotAtTime(snapshots: StateSnapshot[], timestamp: number): StateSnapshot | null {
  let applicable: StateSnapshot | null = null;
  for (const snap of snapshots) {
    if (snap.timestamp <= timestamp) {
      applicable = snap;
    } else {
      break;
    }
  }
  return applicable;
}

/** Make a safe key from a string */
function makeKey(str: string): string {
  return str.replace(KEY_REGEXP, '_');
}

/** Count active jobs per jobType from activeJobIds */
function countActiveByJobType(
  activeJobIds: string[],
  jobs: Record<string, JobRecord>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const jobId of activeJobIds) {
    const job = jobs[jobId];
    if (!job) continue;
    counts[job.jobType] = (counts[job.jobType] ?? 0) + 1;
  }
  return counts;
}

/** Per-model per-jobType entry collected from a snapshot */
interface ModelJobTypeEntry {
  prefix: string;
  totalSlots: number;
  inFlight: number;
}

/** Sum totalSlots across all job types for a model */
function sumModelSlots(jobTypes: Record<string, { totalSlots: number }>): number {
  let total = 0;
  for (const jt of Object.values(jobTypes)) {
    total += jt.totalSlots;
  }
  return total;
}

/** Collect model data from snapshot and populate running counts in data */
function collectModelData(
  shortId: string,
  models: Record<string, { jobTypes?: Record<string, { totalSlots: number; inFlight: number }> }>
): { data: Record<string, number>; entriesByJobType: Record<string, ModelJobTypeEntry[]> } {
  const data: Record<string, number> = {};
  const entriesByJobType: Record<string, ModelJobTypeEntry[]> = {};

  for (const [modelId, modelState] of Object.entries(models)) {
    const modelKey = makeKey(modelId);
    if (!modelState.jobTypes) continue;

    const modelTotalSlots = sumModelSlots(modelState.jobTypes);

    for (const [jobType, jtState] of Object.entries(modelState.jobTypes)) {
      const jtKey = makeKey(jobType);
      const prefix = `${shortId}_${modelKey}_${jtKey}`;

      data[`${prefix}_slots`] = jtState.totalSlots;
      data[`${prefix}_model_slots`] = modelTotalSlots;
      data[`${prefix}_running`] = jtState.inFlight;
      data[`${prefix}_queued`] = 0;

      if (!entriesByJobType[jobType]) {
        entriesByJobType[jobType] = [];
      }
      entriesByJobType[jobType].push({ prefix, totalSlots: jtState.totalSlots, inFlight: jtState.inFlight });
    }
  }

  return { data, entriesByJobType };
}

/** Attribute queued jobs to the bottleneck model (highest utilization ratio) */
function attributeQueuedJobs(
  activeByType: Record<string, number>,
  entriesByJobType: Record<string, ModelJobTypeEntry[]>,
  data: Record<string, number>
): void {
  for (const [jobType, activeCount] of Object.entries(activeByType)) {
    const entries = entriesByJobType[jobType];
    if (!entries || entries.length === 0) continue;

    const totalRunning = entries.reduce((sum, e) => sum + e.inFlight, 0);
    const queued = Math.max(0, activeCount - totalRunning);
    if (queued === 0) continue;

    const bottleneck = findBottleneckEntry(entries);
    data[`${bottleneck.prefix}_queued`] = queued;
  }
}

/** Find the model entry with the highest utilization ratio */
function findBottleneckEntry(entries: ModelJobTypeEntry[]): ModelJobTypeEntry {
  let best = entries[0];
  let highestRatio = 0;
  for (const entry of entries) {
    const ratio = entry.totalSlots > 0 ? entry.inFlight / entry.totalSlots : 0;
    if (ratio > highestRatio) {
      highestRatio = ratio;
      best = entry;
    }
  }
  return best;
}

/** Extract per-jobType per-model data from a snapshot */
function extractSnapshotData(
  snapshot: StateSnapshot | null,
  instanceIdMap: Map<string, string>,
  jobs: Record<string, JobRecord>
): Record<string, number> {
  if (!snapshot) return {};

  const result: Record<string, number> = {};

  for (const [fullId, state] of Object.entries(snapshot.instances)) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    const activeByType = countActiveByJobType(state.activeJobIds, jobs);
    const { data, entriesByJobType } = collectModelData(shortId, state.models);

    Object.assign(result, data);
    attributeQueuedJobs(activeByType, entriesByJobType, result);
  }

  return result;
}

/** Build data point from snapshot */
function buildIntervalDataPoint(
  intervalIndex: number,
  intervalMidpoint: number,
  minTime: number,
  snapshotData: Record<string, number>
): CapacityDataPoint {
  const point: CapacityDataPoint = {
    time: (intervalMidpoint - minTime) / MS_TO_SECONDS,
    timestamp: intervalMidpoint,
    trigger: `interval-${intervalIndex}`,
    ...snapshotData,
  };

  return point;
}

/** Build all data points */
function buildDataPoints(
  testData: TestData,
  minTime: number,
  maxTime: number,
  instanceIdMap: Map<string, string>
): CapacityDataPoint[] {
  const timeSpan = maxTime - minTime;
  const intervalDuration = timeSpan / NUM_INTERVALS;
  const points: CapacityDataPoint[] = [];

  for (let i = 0; i < NUM_INTERVALS; i += 1) {
    const intervalStart = minTime + i * intervalDuration;
    const intervalMidpoint = intervalStart + intervalDuration / 2;

    const snapshot = findSnapshotAtTime(testData.snapshots, intervalMidpoint);
    const snapshotData = extractSnapshotData(snapshot, instanceIdMap, testData.jobs);
    const point = buildIntervalDataPoint(i, intervalMidpoint, minTime, snapshotData);
    points.push(point);
  }

  return points;
}

/** Transform test data to capacity data points */
export function transformToCapacityData(testData: TestData): CapacityDataPoint[] {
  const instanceIdMap = buildInstanceIdMap(testData);
  const { minTime, maxTime } = findTimeSpan(testData);
  // Extend maxTime by one interval so the last real bar covers the final snapshot
  const timeSpan = maxTime - minTime;
  const extraInterval = timeSpan / NUM_INTERVALS;
  const points = buildDataPoints(testData, minTime, maxTime + extraInterval, instanceIdMap);

  // Add padding point at the end with slots carried forward but inFlight zeroed
  const paddingTime = (maxTime + extraInterval * 2 - minTime) / MS_TO_SECONDS;
  const paddingPoint: CapacityDataPoint = {
    time: paddingTime,
    timestamp: maxTime + extraInterval * 2,
    trigger: 'end-padding',
  };

  const lastPoint = points[points.length - 1];
  if (lastPoint) {
    for (const key of Object.keys(lastPoint)) {
      if (key.endsWith('_slots')) {
        paddingPoint[key] = lastPoint[key];
      }
      if (key.endsWith('_running') || key.endsWith('_queued')) {
        paddingPoint[key] = 0;
      }
    }
  }
  points.push(paddingPoint);

  return points;
}

/** Collected metric info per instance */
interface InstanceMetricInfo {
  fullId: string;
  /** Map of modelKey -> Set of jobTypeKeys */
  models: Map<string, Set<string>>;
}

/** Aggregate all model/jobType combinations from snapshots */
function aggregateMetricInfo(testData: TestData): Map<string, InstanceMetricInfo> {
  const aggregated = new Map<string, InstanceMetricInfo>();

  for (const snapshot of testData.snapshots) {
    for (const [fullId, state] of Object.entries(snapshot.instances)) {
      let info = aggregated.get(fullId);
      if (!info) {
        info = { fullId, models: new Map() };
        aggregated.set(fullId, info);
      }

      for (const [modelId, modelState] of Object.entries(state.models)) {
        const modelKey = makeKey(modelId);
        let jobTypes = info.models.get(modelKey);
        if (!jobTypes) {
          jobTypes = new Set();
          info.models.set(modelKey, jobTypes);
        }

        if (modelState.jobTypes) {
          for (const jobType of Object.keys(modelState.jobTypes)) {
            jobTypes.add(jobType);
          }
        }
      }
    }
  }

  return aggregated;
}

/** Build metrics for an instance */
function buildInstanceMetrics(shortId: string, info: InstanceMetricInfo): CapacityMetric[] {
  const metrics: CapacityMetric[] = [];

  for (const [modelKey, jobTypes] of info.models) {
    for (const jobType of jobTypes) {
      const jtKey = makeKey(jobType);
      const prefix = `${shortId}_${modelKey}_${jtKey}`;

      metrics.push({
        key: prefix,
        label: `${modelKey} / ${jobType}`,
        usageKey: `${prefix}_running`,
        queuedKey: `${prefix}_queued`,
        capacityKey: `${prefix}_running`,
        slotsKey: `${prefix}_slots`,
        modelSlotsKey: `${prefix}_model_slots`,
        type: 'jobType',
      });
    }
  }

  return metrics;
}

/** Compute earliest sentAt per (modelKey, jobType) from jobs */
function buildEarliestTimestamps(jobs: Record<string, JobRecord>): Map<string, number> {
  const earliest = new Map<string, number>();
  for (const job of Object.values(jobs)) {
    if (!job.modelUsed) continue;
    const key = `${makeKey(job.modelUsed)}_${job.jobType}`;
    const prev = earliest.get(key) ?? Infinity;
    if (job.sentAt < prev) earliest.set(key, job.sentAt);
  }
  return earliest;
}

/** Compute earliest sentAt per jobType from jobs */
function buildJobTypeOrder(jobs: Record<string, JobRecord>): Map<string, number> {
  const earliest = new Map<string, number>();
  for (const job of Object.values(jobs)) {
    const prev = earliest.get(job.jobType) ?? Infinity;
    if (job.sentAt < prev) earliest.set(job.jobType, job.sentAt);
  }
  return earliest;
}

/** Sort metrics: strict group by jobType (earliest first), then by model within group */
function sortMetrics(metrics: CapacityMetric[], jobs: Record<string, JobRecord>): CapacityMetric[] {
  const metricTimestamps = buildEarliestTimestamps(jobs);
  const jobTypeOrder = buildJobTypeOrder(jobs);

  // Group metrics by jobType
  const groups = new Map<string, CapacityMetric[]>();
  for (const m of metrics) {
    const jt = extractJobType(m.label);
    let group = groups.get(jt);
    if (!group) {
      group = [];
      groups.set(jt, group);
    }
    group.push(m);
  }

  // Sort groups by earliest jobType timestamp, sort models within each
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => (jobTypeOrder.get(a[0]) ?? Infinity) - (jobTypeOrder.get(b[0]) ?? Infinity)
  );

  return sortedGroups.flatMap(([, group]) =>
    group.sort((a, b) => {
      const aKey = extractModelJobTypeKey(a.label);
      const bKey = extractModelJobTypeKey(b.label);
      return (metricTimestamps.get(aKey) ?? Infinity) - (metricTimestamps.get(bKey) ?? Infinity);
    })
  );
}

/** Extract jobType from metric label like "model_alpha / critical" */
function extractJobType(label: string): string {
  const parts = label.split(' / ');
  return parts.length > 1 ? parts[1] : label;
}

/** Extract "modelKey_jobType" from label for timestamp lookup */
function extractModelJobTypeKey(label: string): string {
  const parts = label.split(' / ');
  if (parts.length > 1) return `${parts[0]}_${parts[1]}`;
  return label;
}

/** Get instance configurations from test data */
export function getInstanceConfigs(testData: TestData): InstanceConfig[] {
  const configs: InstanceConfig[] = [];
  const instanceIdMap = buildInstanceIdMap(testData);
  const aggregated = aggregateMetricInfo(testData);

  for (const [fullId, info] of aggregated) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    const metrics = buildInstanceMetrics(shortId, info);
    const sorted = sortMetrics(metrics, testData.jobs);

    configs.push({
      instanceId: shortId,
      fullId,
      models: sorted,
      jobTypes: [],
    });
  }

  return configs;
}
