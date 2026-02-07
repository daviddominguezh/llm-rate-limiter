/**
 * Transform test data into dashboard format for visualization.
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';

import type { DashboardConfig, DashboardDataPoint, InstanceInfo, JobTypeConfig } from './dashboardTypes';
import { JOB_TYPE_COLORS } from './dashboardTypes';

const MODEL_KEY_REGEXP = /[^a-zA-Z0-9]/gu;
const MS_TO_SECONDS = 1000;
const PERCENT_MULTIPLIER = 100;

/** Build instance ID map from test data */
function buildInstanceIdMap(testData: TestData): Map<string, string> {
  const map = new Map<string, string>();
  if (!testData.metadata?.instances) return map;

  const instanceIds = Object.values(testData.metadata.instances);
  instanceIds.forEach((id, index) => {
    map.set(id, `inst${index + 1}`);
  });
  return map;
}

/** Aggregate job type data across all models for an instance */
function aggregateJobTypeData(
  models: TestData['snapshots'][0]['instances'][string]['models']
): Record<string, { slots: number; inFlight: number }> {
  const aggregated: Record<string, { slots: number; inFlight: number }> = {};

  for (const modelState of Object.values(models)) {
    if (!modelState.jobTypes) continue;

    for (const [jobType, jtState] of Object.entries(modelState.jobTypes)) {
      if (!aggregated[jobType]) {
        aggregated[jobType] = { slots: 0, inFlight: 0 };
      }
      aggregated[jobType].slots += jtState.slots;
      aggregated[jobType].inFlight += jtState.inFlight;
    }
  }

  return aggregated;
}

/** Transform a single snapshot to dashboard data point */
function transformSnapshot(
  snapshot: TestData['snapshots'][0],
  startTime: number,
  instanceIdMap: Map<string, string>
): DashboardDataPoint | null {
  if (!snapshot.instances) return null;

  const timeSeconds = (snapshot.timestamp - startTime) / MS_TO_SECONDS;
  const point: DashboardDataPoint = {
    time: `${timeSeconds.toFixed(1)}s`,
    timeSeconds,
  };

  for (const [fullId, state] of Object.entries(snapshot.instances)) {
    const shortId = instanceIdMap.get(fullId) ?? fullId;
    point[`${shortId}_activeJobs`] = state.activeJobs;

    if (state.models) {
      for (const [modelId, modelState] of Object.entries(state.models)) {
        const modelKey = modelId.replace(MODEL_KEY_REGEXP, '_');
        point[`${shortId}_${modelKey}_rpm`] = modelState.rpm;
        point[`${shortId}_${modelKey}_rpmCapacity`] = modelState.rpm + modelState.rpmRemaining;
        point[`${shortId}_${modelKey}_tpm`] = modelState.tpm - modelState.tpmRemaining;
        point[`${shortId}_${modelKey}_tpmCapacity`] = modelState.tpm;
        if (modelState.concurrent !== undefined) {
          point[`${shortId}_${modelKey}_concurrent`] = modelState.concurrent;
          const available = modelState.concurrentAvailable ?? 0;
          point[`${shortId}_${modelKey}_concurrentCapacity`] = modelState.concurrent + available;
        }
      }

      // Aggregate job types across all models
      const jobTypeData = aggregateJobTypeData(state.models);
      const totalSlots = Object.values(jobTypeData).reduce((sum, jt) => sum + jt.slots, 0);

      for (const [jobType, jtData] of Object.entries(jobTypeData)) {
        point[`${shortId}_${jobType}_slots`] = jtData.slots;
        point[`${shortId}_${jobType}_inFlight`] = jtData.inFlight;
        // Compute ratio from slots
        const ratio = totalSlots > 0 ? Math.round((jtData.slots / totalSlots) * PERCENT_MULTIPLIER) : 0;
        point[`${shortId}_${jobType}_ratio`] = ratio;
      }
    }
  }

  return point;
}

/** Transform snapshots to dashboard data points */
export function transformSnapshotsToDashboardData(testData: TestData): DashboardDataPoint[] {
  const { snapshots, metadata } = testData;
  if (!snapshots || snapshots.length === 0) return [];

  const instanceIdMap = buildInstanceIdMap(testData);

  return snapshots
    .map((snapshot) => transformSnapshot(snapshot, metadata.startTime, instanceIdMap))
    .filter((point): point is DashboardDataPoint => point !== null);
}

/** Extract instance info from test data */
export function getInstances(testData: TestData): InstanceInfo[] {
  if (!testData.metadata?.instances) return [];

  const instanceIds = Object.values(testData.metadata.instances);
  return instanceIds.map((fullId, idx) => ({
    shortId: `inst${idx + 1}`,
    fullId,
  }));
}

/** Extract job types from test data (from within models) */
export function getJobTypes(testData: TestData): JobTypeConfig[] {
  const jobTypes = new Set<string>();
  if (!testData.snapshots) return [];

  for (const snapshot of testData.snapshots) {
    if (!snapshot.instances) continue;
    for (const state of Object.values(snapshot.instances)) {
      if (!state.models) continue;
      for (const modelState of Object.values(state.models)) {
        if (!modelState.jobTypes) continue;
        for (const jt of Object.keys(modelState.jobTypes)) {
          jobTypes.add(jt);
        }
      }
    }
  }

  return Array.from(jobTypes).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    color: JOB_TYPE_COLORS[id] ?? JOB_TYPE_COLORS.default,
  }));
}

/** Extract model keys from test data */
export function getModels(testData: TestData): string[] {
  const models = new Set<string>();
  if (!testData.snapshots) return [];

  for (const snapshot of testData.snapshots) {
    if (!snapshot.instances) continue;
    for (const state of Object.values(snapshot.instances)) {
      if (!state.models) continue;
      for (const modelId of Object.keys(state.models)) {
        models.add(modelId.replace(MODEL_KEY_REGEXP, '_'));
      }
    }
  }
  return Array.from(models);
}

/** Get full dashboard config from test data */
export function getDashboardConfig(testData: TestData): DashboardConfig {
  return {
    jobTypes: getJobTypes(testData),
    instances: getInstances(testData),
    models: getModels(testData),
  };
}
