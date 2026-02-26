/**
 * Helper functions for ResourceDashboard gauge and metadata extraction.
 */
import type { ResourceType } from '@/lib/timeseries/dashboardTypes';
import type { CompactInstanceState, CompactModelState, TestData } from '@llm-rate-limiter/e2e-test-results';

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

/** Per-model job usage (jobs and tokens broken down by job type) */
export interface ModelJobUsage {
  modelId: string;
  usage: JobTypeUsage;
}

export interface ModelCapacity {
  modelId: string;
  rpm: number;
  tpm: number;
  rpd: number;
  tpd: number;
  /** Per-instance max concurrent requests (from model config, 0 if not configured) */
  concurrent: number;
}

function positiveOrZero(val: number): number {
  return val > 0 ? val : 0;
}

/** Extract per-model capacity from metadata (provider-imposed limits) */
export function extractModelCapacities(testData: TestData): ModelCapacity[] {
  const caps = testData.metadata.modelCapacities;
  if (!caps) return [];

  return Object.entries(caps)
    .map(([modelId, cap]) => ({
      modelId,
      rpm: positiveOrZero(cap.requestsPerMinute),
      tpm: positiveOrZero(cap.tokensPerMinute),
      rpd: positiveOrZero(cap.requestsPerDay),
      tpd: positiveOrZero(cap.tokensPerDay),
      concurrent: positiveOrZero(cap.maxConcurrentRequests ?? 0),
    }))
    .filter((c) => c.rpm > 0 || c.tpm > 0 || c.rpd > 0 || c.tpd > 0 || c.concurrent > 0);
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

function formatModelLabel(modelId: string): string {
  return modelId.replace(/[_-]/gu, '-');
}

function addGauge(
  gauges: GaugeData[],
  label: string,
  total: number,
  used: number,
  segments: GaugeSegment[]
): void {
  if (total > 0) {
    gauges.push({ resource: label, total, used, segments });
  }
}

/** Build per-model gauges for all applicable resource limits */
export function buildGauges(
  modelUsages: ModelJobUsage[],
  modelCapacities: ModelCapacity[],
  colors: Record<string, string>
): GaugeData[] {
  const gauges: GaugeData[] = [];
  const usageMap = new Map(modelUsages.map((m) => [m.modelId, m.usage]));

  for (const cap of modelCapacities) {
    const usage = usageMap.get(cap.modelId);
    const label = formatModelLabel(cap.modelId);
    const jobSegs = makeSegments(usage?.jobCount ?? {}, colors);
    const tokenSegs = makeSegments(usage?.tokenUsage ?? {}, colors);

    addGauge(gauges, `${label} · RPM`, cap.rpm, usage?.totalJobs ?? 0, jobSegs);
    addGauge(gauges, `${label} · TPM`, cap.tpm, usage?.totalTokens ?? 0, tokenSegs);
    addGauge(gauges, `${label} · RPD`, cap.rpd, usage?.totalJobs ?? 0, jobSegs);
    addGauge(gauges, `${label} · TPD`, cap.tpd, usage?.totalTokens ?? 0, tokenSegs);
    addGauge(gauges, `${label} · Concurrent`, cap.concurrent, usage?.totalJobs ?? 0, jobSegs);
  }

  return gauges.sort((a, b) => {
    const pctA = a.total > 0 ? a.used / a.total : 0;
    const pctB = b.total > 0 ? b.used / b.total : 0;
    return pctB - pctA;
  });
}

/** Combine per-model usages into a single aggregated JobTypeUsage (for legend display) */
export function combineModelUsages(modelUsages: ModelJobUsage[]): JobTypeUsage {
  const result: JobTypeUsage = { jobCount: {}, tokenUsage: {}, totalJobs: 0, totalTokens: 0 };
  for (const mu of modelUsages) {
    for (const [jt, count] of Object.entries(mu.usage.jobCount)) {
      result.jobCount[jt] = (result.jobCount[jt] ?? 0) + count;
    }
    for (const [jt, tokens] of Object.entries(mu.usage.tokenUsage)) {
      result.tokenUsage[jt] = (result.tokenUsage[jt] ?? 0) + tokens;
    }
    result.totalJobs += mu.usage.totalJobs;
    result.totalTokens += mu.usage.totalTokens;
  }
  return result;
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
