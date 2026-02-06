'use client';

import type { DashboardDataPoint, JobTypeConfig } from '@/lib/timeseries/dashboardTypes';

import { ChartContainer, ResourceGauge, SectionHeader } from '../DashboardComponents';

interface ResourceGaugesProps {
  data: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instanceId: string;
}

export function ResourceGauges({ data, jobTypes, instanceId }: ResourceGaugesProps) {
  if (data.length === 0 || jobTypes.length === 0) return null;

  const latest = data[data.length - 1];

  // Calculate totals for slots and in-flight
  const totalSlots = jobTypes.reduce((sum, jt) => {
    const val = latest[`${instanceId}_${jt.id}_slots`];
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  const totalInFlight = jobTypes.reduce((sum, jt) => {
    const val = latest[`${instanceId}_${jt.id}_inFlight`];
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);

  const slotSegments = jobTypes.map((jt) => ({
    color: jt.color,
    value:
      typeof latest[`${instanceId}_${jt.id}_slots`] === 'number'
        ? (latest[`${instanceId}_${jt.id}_slots`] as number)
        : 0,
  }));

  const inFlightSegments = jobTypes.map((jt) => ({
    color: jt.color,
    value:
      typeof latest[`${instanceId}_${jt.id}_inFlight`] === 'number'
        ? (latest[`${instanceId}_${jt.id}_inFlight`] as number)
        : 0,
  }));

  return (
    <ChartContainer>
      <SectionHeader subtitle="Current snapshot across all job types">Resource Utilization</SectionHeader>

      <ResourceGauge
        label="Total Slots"
        used={totalSlots}
        total={Math.max(totalSlots, 1)}
        segments={slotSegments}
      />

      <ResourceGauge
        label="In-Flight Jobs"
        used={totalInFlight}
        total={Math.max(totalSlots, 1)}
        segments={inFlightSegments}
      />

      <div className="flex gap-4 mt-3 flex-wrap">
        {jobTypes.map((jt) => {
          const ratio = latest[`${instanceId}_${jt.id}_ratio`];
          const ratioVal = typeof ratio === 'number' ? ratio : 0;
          return (
            <div key={jt.id} className="flex items-center gap-1.5 text-[11px] font-mono">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: jt.color }} />
              <span className="text-muted-foreground">{jt.label}</span>
              <span className="text-muted-foreground/60">({ratioVal}%)</span>
            </div>
          );
        })}
      </div>
    </ChartContainer>
  );
}
