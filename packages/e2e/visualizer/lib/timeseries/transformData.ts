/**
 * Data transformation utilities for converting TestData to chart format.
 */
import type {
  CompactInstanceState,
  StateSnapshot,
  TestData,
} from '@llm-rate-limiter/e2e-test-results';

import { getMetricColor } from './chartConfig';
import type { ChartDataPoint, MetricCategory, MetricConfig } from './types';

const MIN_PARTS_FOR_SHORT_ID = 2;
const LAST_INDEX_OFFSET = 1;
const FIRST_INSTANCE_INDEX = 1;
const MS_PER_SECOND = 1000;
const FIRST_SNAPSHOT_INDEX = 0;
const MODEL_KEY_REGEXP = /[^a-zA-Z0-9]/gu;

/** Shorten instance ID for display */
function shortenInstanceId(instanceId: string): string {
  const parts = instanceId.split('-');
  const lastIndex = parts.length - LAST_INDEX_OFFSET;
  const lastPart = parts[lastIndex];
  return parts.length > MIN_PARTS_FOR_SHORT_ID ? `inst-${lastPart}` : instanceId;
}

/** Extract metrics from a single instance state */
function extractInstanceMetrics(
  state: CompactInstanceState,
  shortId: string
): Record<string, number> {
  const metrics: Record<string, number> = {};
  metrics[`${shortId}_activeJobs`] = state.activeJobs;

  for (const [modelId, modelState] of Object.entries(state.models)) {
    const { rpm, rpmRemaining } = modelState;
    const modelKey = modelId.replace(MODEL_KEY_REGEXP, '_');
    metrics[`${shortId}_${modelKey}_rpm`] = rpm;
    metrics[`${shortId}_${modelKey}_rpmRemaining`] = rpmRemaining;
  }

  for (const [jobType, jobState] of Object.entries(state.jobTypes)) {
    const { inFlight, slots, ratio } = jobState;
    metrics[`${shortId}_${jobType}_inFlight`] = inFlight;
    metrics[`${shortId}_${jobType}_slots`] = slots;
    metrics[`${shortId}_${jobType}_ratio`] = ratio;
  }

  return metrics;
}

/** Convert a single snapshot to a chart data point */
function snapshotToDataPoint(
  snapshot: StateSnapshot,
  startTime: number,
  instanceIdMap: Map<string, string>
): ChartDataPoint {
  const time = (snapshot.timestamp - startTime) / MS_PER_SECOND;
  const point: ChartDataPoint = {
    time,
    timestamp: snapshot.timestamp,
    trigger: snapshot.trigger,
  };

  for (const [instanceId, state] of Object.entries(snapshot.instances)) {
    const shortId = instanceIdMap.get(instanceId) ?? shortenInstanceId(instanceId);
    const metrics = extractInstanceMetrics(state, shortId);
    Object.assign(point, metrics);
  }

  return point;
}

/** Transform TestData snapshots to chart-friendly format */
export function transformSnapshotsToChartData(
  testData: TestData
): ChartDataPoint[] {
  const { startTime } = testData.metadata;
  const instanceIdMap = buildInstanceIdMap(testData);

  return testData.snapshots.map((snapshot) =>
    snapshotToDataPoint(snapshot, startTime, instanceIdMap)
  );
}

/** Build a map of instance IDs to short display names */
function buildInstanceIdMap(testData: TestData): Map<string, string> {
  const map = new Map<string, string>();
  const instanceIds = Object.values(testData.metadata.instances);
  instanceIds.forEach((id, index) => {
    map.set(id, `inst${index + FIRST_INSTANCE_INDEX}`);
  });
  return map;
}

/** Build metric config from key */
function buildMetricConfig(
  key: string,
  index: number,
  category: MetricCategory,
  label: string
): MetricConfig {
  return { key, label, category, color: getMetricColor(index) };
}

/** Extract job metrics from first snapshot */
function extractJobMetrics(
  instanceId: string,
  state: CompactInstanceState,
  shortId: string,
  metrics: MetricConfig[],
  currentIndex: number
): number {
  let index = currentIndex;
  metrics.push(
    buildMetricConfig(`${shortId}_activeJobs`, index, 'jobs', `${shortId} Active Jobs`)
  );
  index += 1;

  for (const modelId of Object.keys(state.models)) {
    const modelKey = modelId.replace(MODEL_KEY_REGEXP, '_');
    metrics.push(
      buildMetricConfig(
        `${shortId}_${modelKey}_rpm`,
        index,
        'rateLimit',
        `${shortId} ${modelId} RPM`
      )
    );
    index += 1;
  }

  for (const jobType of Object.keys(state.jobTypes)) {
    metrics.push(
      buildMetricConfig(
        `${shortId}_${jobType}_inFlight`,
        index,
        'jobs',
        `${shortId} ${jobType} In-Flight`
      )
    );
    index += 1;
    metrics.push(
      buildMetricConfig(
        `${shortId}_${jobType}_slots`,
        index,
        'capacity',
        `${shortId} ${jobType} Slots`
      )
    );
    index += 1;
  }

  return index;
}

/** Get available metrics from test data */
export function getAvailableMetrics(testData: TestData): MetricConfig[] {
  const metrics: MetricConfig[] = [];
  const firstSnapshot = testData.snapshots[FIRST_SNAPSHOT_INDEX];
  if (firstSnapshot === undefined) return metrics;

  const instanceIdMap = buildInstanceIdMap(testData);
  let index = 0;

  for (const [instanceId, state] of Object.entries(firstSnapshot.instances)) {
    const shortId = instanceIdMap.get(instanceId) ?? shortenInstanceId(instanceId);
    index = extractJobMetrics(instanceId, state, shortId, metrics, index);
  }

  return metrics;
}

/** Get unique instance display IDs from test data */
export function getInstanceIds(testData: TestData): string[] {
  const instanceIdMap = buildInstanceIdMap(testData);
  return Array.from(instanceIdMap.values());
}
