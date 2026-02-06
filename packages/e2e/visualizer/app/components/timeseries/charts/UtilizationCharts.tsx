'use client';

import type { DashboardDataPoint, JobTypeConfig } from '@/lib/timeseries/dashboardTypes';
import { TOOLTIP_STYLE } from '@/lib/timeseries/dashboardTypes';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface UtilizationChartsProps {
  data: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instanceId: string;
}

const CHART_HEIGHT = 260;
const HUNDRED_PERCENT = 100;
const TOOLTIP_OFFSET = 10;

function InFlightUtilizationChart({ data, jobTypes, instanceId }: UtilizationChartsProps) {
  return (
    <ChartContainer>
      <SectionHeader subtitle="Jobs currently being processed per type">
        In-Flight Jobs
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
          {jobTypes.map((jt) => (
            <Line
              key={jt.id}
              type="monotone"
              dataKey={`${instanceId}_${jt.id}_inFlight`}
              name={jt.label}
              stroke={jt.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function DynamicRatioChart({ data, jobTypes, instanceId }: UtilizationChartsProps) {
  return (
    <ChartContainer>
      <SectionHeader subtitle="How resource share shifts with demand pressure">
        Dynamic Ratio Rebalancing
      </SectionHeader>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            domain={[0, HUNDRED_PERCENT]}
            tick={{ fill: '#888', fontSize: 10 }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            formatter={(val) => [`${val}%`]}
            position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          {jobTypes.map((jt) => (
            <Area
              key={jt.id}
              type="monotone"
              dataKey={`${instanceId}_${jt.id}_ratio`}
              name={jt.label}
              stackId="ratio"
              fill={jt.color}
              fillOpacity={0.6}
              stroke={jt.color}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function UtilizationCharts({ data, jobTypes, instanceId }: UtilizationChartsProps) {
  if (data.length === 0 || jobTypes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
      <InFlightUtilizationChart data={data} jobTypes={jobTypes} instanceId={instanceId} />
      <DynamicRatioChart data={data} jobTypes={jobTypes} instanceId={instanceId} />
    </div>
  );
}
