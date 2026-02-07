/**
 * Helper functions for ResourceDashboard gauge and metadata extraction.
 */
import type { ResourceType } from '@/lib/timeseries/dashboardTypes';
import type {
  CompactInstanceState,
  CompactModelState,
  JobRecord,
  StateSnapshot,
  TestData,
} from '@llm-rate-limiter/e2e-test-results';

const JOB_TYPE_PALETTE = [
  '#E85E3B',
  '#3B8EE8',
  '#5EBB6E',
  '#D4A843',
  '#9B59B6',
  '#E67E22',
  '#1ABC9C',
  '#E74C3C',
];

const RATIO_PERCENT = 100;

export interface GaugeSegment {
  jobType: string;
  used: number;
  color: string;
}

export interface GaugeData {
  resource: string;
  total: number;
  used: number;
  segments: GaugeSegment[];
}

export interface RealJobTypeInfo {
  id: string;
  color: string;
  slotsRatio: number;
}

export interface JobTypeUsage {
  jobCount: Record<string, number>;
  tokenUsage: Record<string, number>;
  totalJobs: number;
  totalTokens: number;
}

function sumJobTokens(job: JobRecord): number {
  let tokens = 0;
  for (const entry of job.usage) {
    tokens += entry.inputTokens + entry.outputTokens;
  }
  return tokens;
}

export function computeJobUsage(testData: TestData): JobTypeUsage {
  const result: JobTypeUsage = { jobCount: {}, tokenUsage: {}, totalJobs: 0, totalTokens: 0 };

  for (const job of Object.values(testData.jobs)) {
    const tokens = sumJobTokens(job);
    result.jobCount[job.jobType] = (result.jobCount[job.jobType] ?? 0) + 1;
    result.tokenUsage[job.jobType] = (result.tokenUsage[job.jobType] ?? 0) + tokens;
    result.totalJobs += 1;
    result.totalTokens += tokens;
  }

  return result;
}

function sumModelCapacity(models: Record<string, CompactModelState>): { rpm: number; tpm: number } {
  let rpm = 0;
  let tpm = 0;
  for (const model of Object.values(models)) {
    rpm += model.rpm + model.rpmRemaining;
    tpm += model.tpm + model.tpmRemaining;
  }
  return { rpm, tpm };
}

function sumSnapshotCapacity(snapshot: StateSnapshot): { rpm: number; tpm: number } {
  let rpm = 0;
  let tpm = 0;
  for (const state of Object.values(snapshot.instances)) {
    const cap = sumModelCapacity(state.models);
    rpm += cap.rpm;
    tpm += cap.tpm;
  }
  return { rpm, tpm };
}

export function extractCapacity(testData: TestData): { rpm: number; tpm: number } {
  for (const snapshot of testData.snapshots) {
    const cap = sumSnapshotCapacity(snapshot);
    if (cap.rpm > 0 || cap.tpm > 0) return cap;
  }
  return { rpm: 0, tpm: 0 };
}

export function assignJobTypeColors(jobTypeIds: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  jobTypeIds.forEach((id, i) => {
    colors[id] = JOB_TYPE_PALETTE[i % JOB_TYPE_PALETTE.length];
  });
  return colors;
}

function makeSegments(usage: Record<string, number>, colors: Record<string, string>): GaugeSegment[] {
  return Object.entries(usage)
    .map(([jt, used]) => ({ jobType: jt, used, color: colors[jt] ?? '#888' }))
    .sort((a, b) => b.used - a.used);
}

function buildRpmGauge(
  jobUsage: JobTypeUsage,
  capacity: { rpm: number },
  colors: Record<string, string>
): GaugeData | null {
  if (capacity.rpm <= 0) return null;
  return {
    resource: 'RPM',
    total: capacity.rpm,
    used: jobUsage.totalJobs,
    segments: makeSegments(jobUsage.jobCount, colors),
  };
}

function buildTpmGauge(
  jobUsage: JobTypeUsage,
  capacity: { tpm: number },
  colors: Record<string, string>
): GaugeData | null {
  if (capacity.tpm <= 0 || jobUsage.totalTokens <= 0) return null;
  return {
    resource: 'TPM',
    total: capacity.tpm,
    used: jobUsage.totalTokens,
    segments: makeSegments(jobUsage.tokenUsage, colors),
  };
}

export function buildGauges(
  jobUsage: JobTypeUsage,
  capacity: { rpm: number; tpm: number },
  colors: Record<string, string>
): GaugeData[] {
  const gauges: GaugeData[] = [];

  const rpmGauge = buildRpmGauge(jobUsage, capacity, colors);
  if (rpmGauge) gauges.push(rpmGauge);

  const tpmGauge = buildTpmGauge(jobUsage, capacity, colors);
  if (tpmGauge) gauges.push(tpmGauge);

  gauges.sort((a, b) => {
    const pctA = a.total > 0 ? a.used / a.total : 0;
    const pctB = b.total > 0 ? b.used / b.total : 0;
    return pctB - pctA;
  });

  return gauges;
}

export function buildJobTypeInfo(jobUsage: JobTypeUsage, colors: Record<string, string>): RealJobTypeInfo[] {
  return Object.entries(jobUsage.jobCount)
    .map(([jt, count]) => ({
      id: jt,
      color: colors[jt] ?? '#888',
      slotsRatio: jobUsage.totalJobs > 0 ? Math.round((count / jobUsage.totalJobs) * RATIO_PERCENT) : 0,
    }))
    .sort((a, b) => b.slotsRatio - a.slotsRatio);
}

function detectModelResources(model: CompactModelState): { rpm: boolean; tpm: boolean; concurrent: boolean } {
  return {
    rpm: model.rpm > 0 || model.rpmRemaining > 0,
    tpm: model.tpm > 0 || model.tpmRemaining > 0,
    concurrent: model.concurrent !== undefined,
  };
}

function detectInstanceResources(state: CompactInstanceState): {
  rpm: boolean;
  tpm: boolean;
  concurrent: boolean;
} {
  const flags = { rpm: false, tpm: false, concurrent: false };
  for (const model of Object.values(state.models)) {
    const detected = detectModelResources(model);
    if (detected.rpm) flags.rpm = true;
    if (detected.tpm) flags.tpm = true;
    if (detected.concurrent) flags.concurrent = true;
  }
  return flags;
}

export function countResourceDimensions(testData: TestData): number {
  let hasRpm = false;
  let hasTpm = false;
  let hasConcurrent = false;

  for (const snapshot of testData.snapshots) {
    for (const state of Object.values(snapshot.instances)) {
      const flags = detectInstanceResources(state);
      if (flags.rpm) hasRpm = true;
      if (flags.tpm) hasTpm = true;
      if (flags.concurrent) hasConcurrent = true;
    }
    if (hasRpm && hasTpm && hasConcurrent) break;
  }

  return Number(hasRpm) + Number(hasTpm) + Number(hasConcurrent);
}

/** Determine which resource types have data in the test snapshots */
export function getEnabledResourceTypes(testData: TestData): Set<ResourceType> {
  const enabled = new Set<ResourceType>();

  for (const snapshot of testData.snapshots) {
    for (const state of Object.values(snapshot.instances)) {
      const flags = detectInstanceResources(state);
      if (flags.rpm) enabled.add('RPM');
      if (flags.tpm) enabled.add('TPM');
      if (flags.concurrent) enabled.add('Concurrent');
    }
  }

  return enabled;
}
