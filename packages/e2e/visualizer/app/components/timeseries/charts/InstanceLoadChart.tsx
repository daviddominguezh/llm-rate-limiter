'use client';

import type { DashboardDataPoint, InstanceInfo } from '@/lib/timeseries/dashboardTypes';
import { INSTANCE_COLORS, TOOLTIP_STYLE } from '@/lib/timeseries/dashboardTypes';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface InstanceLoadChartProps {
  data: DashboardDataPoint[];
  instances: InstanceInfo[];
}

const CHART_HEIGHT = 220;
const TOOLTIP_OFFSET = 10;

export function InstanceLoadChart({ data, instances }: InstanceLoadChartProps) {
  if (data.length === 0 || instances.length === 0) return null;

  return (
    <ChartContainer>
      <SectionHeader subtitle="Concurrent jobs running on each distributed node">
        Per-Instance Active Jobs
      </SectionHeader>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#888', fontSize: 10 }} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          {instances.map((inst, i) => (
            <Line
              key={inst.shortId}
              type="monotone"
              dataKey={`${inst.shortId}_activeJobs`}
              name={inst.shortId}
              stroke={INSTANCE_COLORS[i % INSTANCE_COLORS.length]}
              strokeWidth={2}
              dot={false}
              strokeDasharray={i > 0 ? '5 3' : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
