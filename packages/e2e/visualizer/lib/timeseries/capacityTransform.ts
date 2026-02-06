/**
 * Transform test data into capacity-based format for visualization.
 * Uses interval-based approach: divides time span into 500 intervals
 * and counts active jobs per interval.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { CapacityDataPoint, CapacityMetric, InstanceConfig } from './capacityTypes';

const FIRST_INSTANCE_INDEX = 1;
const MODEL_KEY_REGEXP = /[^a-zA-Z0-9]/gu;
const NUM_INTERVALS = 500;
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

interface JobTimeRange {
  jobId: string;
  instanceId: string;
  modelId: string | null;
  startTime: number;
  endTime: number;
}

/** Extract job time ranges (start to end) from jobs data */
function extractJobTimeRanges(testData: TestData): JobTimeRange[] {
  const ranges: JobTimeRange[] = [];

  for (const job of Object.values(testData.jobs)) {
    let startTime: number | null = null;
    let endTime: number | null = null;
    let modelId: string | null = null;

    for (const event of job.events) {
      if (event.type === 'started') {
        startTime = event.timestamp;
        modelId = event.modelId ?? null;
      }
      if (event.type === 'completed' || event.type === 'failed') {
        endTime = event.timestamp;
      }
    }

    if (startTime !== null && endTime !== null) {
      ranges.push({ jobId: job.jobId, instanceId: job.instanceId, modelId, startTime, endTime });
    }
  }

  return ranges;
}

/** Find the time span of all jobs */
function findTimeSpan(ranges: JobTimeRange[]): { minTime: number; maxTime: number } {
  if (ranges.length === 0) {
    return { minTime: 0, maxTime: 1 };
  }

  let minTime = Infinity;
  let maxTime = 0;

  for (const range of ranges) {
    if (range.startTime < minTime) minTime = range.startTime;
    if (range.endTime > maxTime) maxTime = range.endTime;
  }

  return { minTime, maxTime };
}

/** Count active jobs for a single interval */
function countActiveJobsForInterval(
  ranges: JobTimeRange[],
  intervalStart: number,
  intervalEnd: number,
  instanceIdMap: Map<string, string>
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};

  for (const range of ranges) {
    if (range.startTime < intervalEnd && range.endTime > intervalStart) {
      const shortId = instanceIdMap.get(range.instanceId) ?? range.instanceId;

      if (!counts[shortId]) {
        counts[shortId] = {};
      }

      const modelKey = range.modelId ? range.modelId.replace(MODEL_KEY_REGEXP, '_') : 'unknown';

      if (!counts[shortId][modelKey]) {
        counts[shortId][modelKey] = 0;
      }

      counts[shortId][modelKey] += 1;
    }
  }

  return counts;
}

/** Build data point from active job counts */
function buildIntervalDataPoint(
  intervalIndex: number,
  intervalMidpoint: number,
  minTime: number,
  activeJobCounts: Record<string, Record<string, number>>
): CapacityDataPoint {
  const point: CapacityDataPoint = {
    time: (intervalMidpoint - minTime) / MS_TO_SECONDS,
    timestamp: intervalMidpoint,
    trigger: `interval-${intervalIndex}`,
  };

  for (const [shortId, models] of Object.entries(activeJobCounts)) {
    let totalActive = 0;
    for (const [modelKey, count] of Object.entries(models)) {
      point[`${shortId}_${modelKey}_active`] = count;
      totalActive += count;
    }
    point[`${shortId}_activeJobs`] = totalActive;
  }

  return point;
}

/** Count active jobs per interval */
function countActiveJobsPerInterval(
  ranges: JobTimeRange[],
  minTime: number,
  maxTime: number,
  instanceIdMap: Map<string, string>
): CapacityDataPoint[] {
  const timeSpan = maxTime - minTime;
  const intervalDuration = timeSpan / NUM_INTERVALS;
  const points: CapacityDataPoint[] = [];

  for (let i = 0; i < NUM_INTERVALS; i += 1) {
    const intervalStart = minTime + i * intervalDuration;
    const intervalEnd = intervalStart + intervalDuration;
    const intervalMidpoint = intervalStart + intervalDuration / 2;

    const activeJobCounts = countActiveJobsForInterval(ranges, intervalStart, intervalEnd, instanceIdMap);
    const point = buildIntervalDataPoint(i, intervalMidpoint, minTime, activeJobCounts);
    points.push(point);
  }

  return points;
}

/** Transform test data to capacity data points */
export function transformToCapacityData(testData: TestData): CapacityDataPoint[] {
  const instanceIdMap = buildInstanceIdMap(testData);
  const ranges = extractJobTimeRanges(testData);
  const { minTime, maxTime } = findTimeSpan(ranges);
  const points = countActiveJobsPerInterval(ranges, minTime, maxTime, instanceIdMap);

  // Add padding point at the end so the last real interval has width
  const timeSpan = maxTime - minTime;
  const intervalDuration = timeSpan / NUM_INTERVALS;
  const paddingTime = (maxTime + intervalDuration - minTime) / MS_TO_SECONDS;
  const paddingPoint: CapacityDataPoint = {
    time: paddingTime,
    timestamp: maxTime + intervalDuration,
    trigger: 'end-padding',
  };
  // Copy keys from first point with value 0
  const firstPoint = points[0];
  for (const key of Object.keys(firstPoint)) {
    if (key.endsWith('_active')) {
      paddingPoint[key] = 0;
    }
  }
  points.push(paddingPoint);

  return points;
}

interface AggregatedInstanceData {
  fullId: string;
  modelIds: Set<string>;
}

/** Aggregate models from jobs data */
function aggregateModelsFromJobs(testData: TestData): Map<string, Set<string>> {
  const instanceModels = new Map<string, Set<string>>();

  for (const job of Object.values(testData.jobs)) {
    if (job.modelUsed) {
      let models = instanceModels.get(job.instanceId);
      if (!models) {
        models = new Set();
        instanceModels.set(job.instanceId, models);
      }
      models.add(job.modelUsed);
    }
  }

  return instanceModels;
}

/** Aggregate all models across all snapshots and jobs for each instance */
function aggregateInstanceData(testData: TestData): Map<string, AggregatedInstanceData> {
  const aggregated = new Map<string, AggregatedInstanceData>();

  // Get models from snapshots
  for (const snapshot of testData.snapshots) {
    for (const [fullId, state] of Object.entries(snapshot.instances)) {
      let data = aggregated.get(fullId);
      if (!data) {
        data = { fullId, modelIds: new Set() };
        aggregated.set(fullId, data);
      }

      for (const modelId of Object.keys(state.models)) {
        data.modelIds.add(modelId);
      }
    }
  }

  // Add models from jobs (includes escalation/fallback models)
  const jobModels = aggregateModelsFromJobs(testData);
  for (const [instanceId, models] of jobModels) {
    const data = aggregated.get(instanceId);
    if (data) {
      for (const modelId of models) {
        data.modelIds.add(modelId);
      }
    }
  }

  return aggregated;
}

/** Build model metrics from aggregated model IDs */
function buildModelMetricsFromIds(modelIds: Set<string>, shortId: string): CapacityMetric[] {
  const metrics: CapacityMetric[] = [];

  for (const modelId of modelIds) {
    const modelKey = modelId.replace(MODEL_KEY_REGEXP, '_');
    const prefix = `${shortId}_${modelKey}`;

    metrics.push({
      key: `${prefix}_active`,
      label: `${modelId}`,
      usageKey: `${prefix}_active`,
      capacityKey: `${prefix}_active`,
      type: 'model',
    });
  }

  return metrics;
}

/** Get instance configurations from test data */
export function getInstanceConfigs(testData: TestData): InstanceConfig[] {
  const configs: InstanceConfig[] = [];
  const instanceIdMap = buildInstanceIdMap(testData);
  const aggregated = aggregateInstanceData(testData);

  for (const [fullId, data] of aggregated) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    const modelMetrics = buildModelMetricsFromIds(data.modelIds, shortId);

    configs.push({
      instanceId: shortId,
      fullId,
      models: modelMetrics,
      jobTypes: [],
    });
  }

  return configs;
}
