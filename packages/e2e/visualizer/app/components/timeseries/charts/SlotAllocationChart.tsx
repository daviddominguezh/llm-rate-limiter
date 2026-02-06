'use client';

import type { DashboardDataPoint, JobTypeConfig, InstanceInfo } from '@/lib/timeseries/dashboardTypes';
import { TOOLTIP_STYLE } from '@/lib/timeseries/dashboardTypes';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface SlotAllocationChartProps {
  data: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instances: InstanceInfo[];
}

const CHART_HEIGHT = 320;
const TOOLTIP_OFFSET = 10;

export function SlotAllocationChart({ data, jobTypes, instances }: SlotAllocationChartProps) {
  if (data.length === 0 || jobTypes.length === 0) return null;

  return (
    <ChartContainer>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <SectionHeader subtitle="Dynamic ratio rebalancing in action — watch allocations shift with demand">
          Slot Allocation Over Time
        </SectionHeader>
      </div>

      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#888', fontSize: 10 }} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600, marginBottom: '6px' }}
            position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          {instances.flatMap((inst) =>
            jobTypes.map((jt) => (
              <Area
                key={`${inst.shortId}_${jt.id}_slots`}
                type="monotone"
                dataKey={`${inst.shortId}_${jt.id}_slots`}
                name={`${inst.shortId} ${jt.label} Slots`}
                stackId={inst.shortId}
                fill={jt.color}
                fillOpacity={0.3}
                stroke={jt.color}
                strokeWidth={1.5}
              />
            ))
          )}
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex gap-6 justify-center mt-2 text-[11px] font-mono">
        {jobTypes.map((jt) => (
          <span key={jt.id} className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: jt.color }}
            />
            {jt.label}
          </span>
        ))}
      </div>
    </ChartContainer>
  );
}
