'use client';

import { aggregateChartData } from '@/lib/timeseries/aggregateData';
import type { ModelCapacityConfig } from '@/lib/timeseries/aggregateData';
import {
  getDashboardConfig,
  getInstances,
  transformSnapshotsToDashboardData,
} from '@/lib/timeseries/dashboardTransform';
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { useMemo, useState } from 'react';

import { ChartContainer, ResourceGauge, SectionHeader } from './DashboardComponents';
import { AggregatedJobTypeTable } from './charts/AggregatedJobTypeTable';
import { AggregatedUtilizationCharts } from './charts/AggregatedUtilizationCharts';
import { AllocationOverTimeChart } from './charts/AllocationOverTimeChart';
import { InstanceLoadChart } from './charts/InstanceLoadChart';
import type { GaugeData, MinuteBoundary, RealJobTypeInfo } from './resourceDashboardHelpers';
import {
  assignJobTypeColors,
  buildGauges,
  buildJobTypeInfo,
  computeJobUsage,
  computeJobUsageForWindow,
  computeMinuteBoundaries,
  countResourceDimensions,
  extractCapacity,
  getEnabledResourceTypes,
} from './resourceDashboardHelpers';

interface ResourceDashboardProps {
  testData: TestData;
}

interface JobTimeBounds {
  startSeconds: number;
  endSeconds: number;
}

const MS_TO_SECONDS = 1000;
const MODEL_KEY_REGEXP = /[^a-zA-Z0-9]/gu;

/** Build capacity map from metadata using transformed model keys */
function buildModelCapacityMap(testData: TestData): Map<string, ModelCapacityConfig> {
  const map = new Map<string, ModelCapacityConfig>();
  const caps = testData.metadata.modelCapacities;
  if (!caps) return map;

  for (const [modelId, cap] of Object.entries(caps)) {
    const key = modelId.replace(MODEL_KEY_REGEXP, '_');
    map.set(key, { tpm: Math.max(0, cap.tokensPerMinute), rpm: Math.max(0, cap.requestsPerMinute) });
  }
  return map;
}

function getJobTimeBounds(testData: TestData): JobTimeBounds | null {
  const jobs = Object.values(testData.jobs);
  if (jobs.length === 0) return null;

  const earliest = jobs.reduce((a, b) => (a.sentAt < b.sentAt ? a : b));
  const latestEndTs = jobs.reduce((max, job) => {
    const end = job.events[job.events.length - 1]?.timestamp ?? 0;
    return end > max ? end : max;
  }, 0);

  return {
    startSeconds: (earliest.sentAt - testData.metadata.startTime) / MS_TO_SECONDS,
    endSeconds: (latestEndTs - testData.metadata.startTime) / MS_TO_SECONDS,
  };
}

function capitalize(str: string): string {
  return str.length > 0 ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

interface GaugesSectionProps {
  gauges: GaugeData[];
  jobTypes: RealJobTypeInfo[];
  minuteBoundaries: MinuteBoundary[];
  selectedMinute: number;
  onSelectMinute: (idx: number) => void;
}

function GaugesSection({ gauges, jobTypes, minuteBoundaries, selectedMinute, onSelectMinute }: GaugesSectionProps) {
  return (
    <ChartContainer>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <SectionHeader subtitle="Usage per rate-limit window">Resource Utilization</SectionHeader>
        <MinuteTabs boundaries={minuteBoundaries} selected={selectedMinute} onSelect={onSelectMinute} />
      </div>
      {gauges.map((g) => (
        <ResourceGauge
          key={g.resource}
          label={g.resource}
          used={g.used}
          total={g.total}
          segments={g.segments.map((s) => ({ color: s.color, value: s.used }))}
        />
      ))}
      <div className="flex gap-4 mt-3 flex-wrap">
        {jobTypes.map((jt) => (
          <div key={jt.id} className="flex items-center gap-1.5 text-[11px] font-mono">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: jt.color }} />
            <span className="text-muted-foreground">{capitalize(jt.id)}</span>
            <span className="text-muted-foreground/60">({jt.slotsRatio}%)</span>
          </div>
        ))}
      </div>
    </ChartContainer>
  );
}

function DashboardHeader({
  instanceCount,
  jobTypeCount,
  resourceDimensionCount,
}: {
  instanceCount: number;
  jobTypeCount: number;
  resourceDimensionCount: number;
}) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-foreground tracking-tight">Rate Limiter · Job Queue</h1>
      <p className="text-xs text-muted-foreground/60 mt-1.5 font-mono">
        Distributed resource orchestration — {instanceCount} instances · {jobTypeCount} job types ·{' '}
        {resourceDimensionCount} resource dimensions
      </p>
    </div>
  );
}

const MIN_TABS_TO_SHOW = 2;

function minuteTabClass(isActive: boolean): string {
  const base = 'px-3.5 py-1.5 rounded-md text-xs font-mono border transition-all';
  if (isActive) return `${base} bg-white/8 text-foreground border-white/15`;
  return `${base} text-muted-foreground border-white/6 hover:border-white/15 hover:text-muted-foreground/80 cursor-pointer`;
}

function MinuteTabs({
  boundaries,
  selected,
  onSelect,
}: {
  boundaries: MinuteBoundary[];
  selected: number;
  onSelect: (idx: number) => void;
}) {
  if (boundaries.length < MIN_TABS_TO_SHOW) return null;

  return (
    <div className="flex gap-1.5 mb-6">
      {boundaries.map((b, idx) => (
        <button key={b.label} className={minuteTabClass(selected === idx)} onClick={() => onSelect(idx)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

export function ResourceDashboard({ testData }: ResourceDashboardProps) {
  const config = useMemo(() => getDashboardConfig(testData), [testData]);
  const instances = useMemo(() => getInstances(testData), [testData]);
  const rawData = useMemo(() => transformSnapshotsToDashboardData(testData), [testData]);
  const modelCapacities = useMemo(() => buildModelCapacityMap(testData), [testData]);
  const aggregatedData = useMemo(
    () => aggregateChartData(rawData, config.jobTypes, instances, config.models, modelCapacities),
    [rawData, config.jobTypes, instances, config.models, modelCapacities]
  );
  const jobTimeBounds = useMemo(() => getJobTimeBounds(testData), [testData]);
  const chartData = useMemo(() => {
    if (!jobTimeBounds) return aggregatedData;
    return aggregatedData.filter(
      (p) => p.timeSeconds >= jobTimeBounds.startSeconds && p.timeSeconds <= jobTimeBounds.endSeconds
    );
  }, [aggregatedData, jobTimeBounds]);
  const minuteBoundaries = useMemo(() => computeMinuteBoundaries(testData), [testData]);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const enabledResourceTypes = useMemo(() => getEnabledResourceTypes(testData), [testData]);

  const instanceCount = Object.keys(testData.metadata.instances).length;
  const jobTypeCount = Object.keys(testData.summary.byJobType).length;
  const resourceDimensionCount = countResourceDimensions(testData);

  const allJobUsage = computeJobUsage(testData);
  const selectedBoundary = minuteBoundaries[selectedMinute];
  const jobUsage = selectedBoundary ? computeJobUsageForWindow(testData, selectedBoundary) : allJobUsage;
  const capacity = extractCapacity(testData);
  const realJobTypeIds = Object.keys(allJobUsage.jobCount);
  const jobTypeColors = assignJobTypeColors(realJobTypeIds);
  const gauges = buildGauges(jobUsage, capacity, jobTypeColors);
  const realJobTypes = buildJobTypeInfo(jobUsage, jobTypeColors);

  return (
    <div className="px-6 py-6 text-muted-foreground">
      <DashboardHeader
        instanceCount={instanceCount}
        jobTypeCount={jobTypeCount}
        resourceDimensionCount={resourceDimensionCount}
      />
      <GaugesSection
        gauges={gauges}
        jobTypes={realJobTypes}
        minuteBoundaries={minuteBoundaries}
        selectedMinute={selectedMinute}
        onSelectMinute={setSelectedMinute}
      />
      <AllocationOverTimeChart
        data={chartData}
        models={config.models}
        enabledResourceTypes={enabledResourceTypes}
      />
      <AggregatedUtilizationCharts data={chartData} jobTypes={config.jobTypes} />
      <InstanceLoadChart data={chartData} instances={instances} />
      <AggregatedJobTypeTable data={chartData} jobTypes={config.jobTypes} />

      <div className="text-center mt-8 text-xs text-muted-foreground/40 font-mono">
        Distributed Rate Limiter — Dynamic Resource Allocation Visualization
      </div>
    </div>
  );
}
