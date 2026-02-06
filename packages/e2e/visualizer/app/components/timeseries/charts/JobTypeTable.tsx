'use client';

import type { DashboardDataPoint, JobTypeConfig } from '@/lib/timeseries/dashboardTypes';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface JobTypeTableProps {
  data: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instanceId: string;
}

function getUtilizationColor(pct: number): { bg: string; text: string } {
  const HIGH_THRESHOLD = 75;
  const MED_THRESHOLD = 40;

  if (pct > HIGH_THRESHOLD) {
    return { bg: 'rgba(232,94,59,0.15)', text: '#E8715A' };
  }
  if (pct > MED_THRESHOLD) {
    return { bg: 'rgba(212,168,67,0.15)', text: '#D4A843' };
  }
  return { bg: 'rgba(94,187,110,0.15)', text: '#5EBB6E' };
}

export function JobTypeTable({ data, jobTypes, instanceId }: JobTypeTableProps) {
  if (data.length === 0 || jobTypes.length === 0) return null;

  const latest = data[data.length - 1];

  return (
    <ChartContainer>
      <SectionHeader subtitle="Current state of job type allocations">
        Job Type Status
      </SectionHeader>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs font-mono">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left p-2 text-muted-foreground font-medium">Job Type</th>
              <th className="text-right p-2 text-muted-foreground font-medium">Ratio</th>
              <th className="text-right p-2 text-muted-foreground font-medium">Slots</th>
              <th className="text-right p-2 text-muted-foreground font-medium">In-Flight</th>
              <th className="text-right p-2 text-muted-foreground font-medium">Utilization</th>
            </tr>
          </thead>
          <tbody>
            {jobTypes.map((jt) => {
              const ratio = latest[`${instanceId}_${jt.id}_ratio`];
              const slots = latest[`${instanceId}_${jt.id}_slots`];
              const inFlight = latest[`${instanceId}_${jt.id}_inFlight`];

              const ratioVal = typeof ratio === 'number' ? ratio : 0;
              const slotsVal = typeof slots === 'number' ? slots : 0;
              const inFlightVal = typeof inFlight === 'number' ? inFlight : 0;
              const utilization = slotsVal > 0 ? Math.round((inFlightVal / slotsVal) * 100) : 0;
              const colors = getUtilizationColor(utilization);

              return (
                <tr key={jt.id} className="border-b border-white/5">
                  <td className="p-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ background: jt.color }}
                      />
                      <span className="text-foreground/80">{jt.label}</span>
                    </div>
                  </td>
                  <td className="text-right p-2.5" style={{ color: jt.color, fontWeight: 600 }}>
                    {ratioVal}%
                  </td>
                  <td className="text-right p-2.5 text-muted-foreground">{slotsVal}</td>
                  <td className="text-right p-2.5 text-muted-foreground">{inFlightVal}</td>
                  <td className="text-right p-2.5">
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{ background: colors.bg, color: colors.text }}
                    >
                      {utilization}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartContainer>
  );
}
