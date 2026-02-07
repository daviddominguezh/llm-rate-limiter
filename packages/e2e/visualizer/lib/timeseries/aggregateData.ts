/**
 * Aggregate per-instance dashboard data into totals for chart visualization.
 */
import type { DashboardDataPoint, InstanceInfo, JobTypeConfig } from './dashboardTypes';

const PERCENT_MULTIPLIER = 100;

/** Get a numeric value from a data point, defaulting to 0 */
function numVal(point: DashboardDataPoint, key: string): number {
  const val = point[key];
  return typeof val === 'number' ? val : 0;
}

/** Aggregate job type data across instances for one data point */
function aggregateJobTypes(
  agg: DashboardDataPoint,
  point: DashboardDataPoint,
  jobTypes: JobTypeConfig[],
  instances: InstanceInfo[]
): void {
  for (const jt of jobTypes) {
    let totalSlots = 0;
    let totalInFlight = 0;
    let totalRatio = 0;

    for (const inst of instances) {
      totalSlots += numVal(point, `${inst.shortId}_${jt.id}_slots`);
      totalInFlight += numVal(point, `${inst.shortId}_${jt.id}_inFlight`);
      totalRatio += numVal(point, `${inst.shortId}_${jt.id}_ratio`);
    }

    agg[`${jt.id}_slots`] = totalSlots;
    agg[`${jt.id}_inFlight`] = totalInFlight;
    const avgRatio = instances.length > 0 ? totalRatio / instances.length : 0;
    agg[`${jt.id}_ratio`] = Math.round(avgRatio);
    const utilPct = totalSlots > 0 ? (totalInFlight / totalSlots) * PERCENT_MULTIPLIER : 0;
    agg[`${jt.id}_utilization`] = Math.round(utilPct);
  }
}

/** Aggregate a single model's RPM/TPM/Concurrent data across instances */
function aggregateSingleModel(
  agg: DashboardDataPoint,
  point: DashboardDataPoint,
  model: string,
  instances: InstanceInfo[]
): void {
  let rpm = 0;
  let rpmCap = 0;
  let tpm = 0;
  let tpmCap = 0;
  let concurrent = 0;
  let concurrentCap = 0;

  for (const inst of instances) {
    const prefix = `${inst.shortId}_${model}`;
    rpm += numVal(point, `${prefix}_rpm`);
    rpmCap += numVal(point, `${prefix}_rpmCapacity`);
    tpm += numVal(point, `${prefix}_tpm`);
    tpmCap += numVal(point, `${prefix}_tpmCapacity`);
    concurrent += numVal(point, `${prefix}_concurrent`);
    concurrentCap += numVal(point, `${prefix}_concurrentCapacity`);
  }

  agg[`${model}_rpm`] = rpm;
  agg[`${model}_rpmCapacity`] = rpmCap;
  agg[`${model}_tpm`] = tpm;
  agg[`${model}_tpmCapacity`] = tpmCap;
  agg[`${model}_concurrent`] = concurrent;
  agg[`${model}_concurrentCapacity`] = concurrentCap;
}

/** Aggregate model-level RPM/TPM/Concurrent across all instances */
function aggregateModelMetrics(
  agg: DashboardDataPoint,
  point: DashboardDataPoint,
  models: string[],
  instances: InstanceInfo[]
): void {
  for (const model of models) {
    aggregateSingleModel(agg, point, model, instances);
  }
}

/** Copy per-instance active jobs into aggregated point */
function copyInstanceJobs(
  agg: DashboardDataPoint,
  point: DashboardDataPoint,
  instances: InstanceInfo[]
): void {
  for (const inst of instances) {
    agg[`${inst.shortId}_activeJobs`] = numVal(point, `${inst.shortId}_activeJobs`);
  }
}

/** Aggregate dashboard data across all instances for chart visualization */
export function aggregateChartData(
  data: DashboardDataPoint[],
  jobTypes: JobTypeConfig[],
  instances: InstanceInfo[],
  models: string[]
): DashboardDataPoint[] {
  return data.map((point) => {
    const agg: DashboardDataPoint = { time: point.time, timeSeconds: point.timeSeconds };
    aggregateJobTypes(agg, point, jobTypes, instances);
    aggregateModelMetrics(agg, point, models, instances);
    copyInstanceJobs(agg, point, instances);
    return agg;
  });
}
