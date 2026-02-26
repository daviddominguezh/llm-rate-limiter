'use client';

import type { DashboardDataPoint, InstanceInfo, JobTypeConfig } from '@/lib/timeseries/dashboardTypes';
import { TOOLTIP_STYLE } from '@/lib/timeseries/dashboardTypes';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface AggregatedUtilizationChartsProps {
  data: DashboardDataPoint[];
  rawData: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instances: InstanceInfo[];
}

const CHART_HEIGHT = 260;
const HUNDRED_PERCENT = 100;

function formatTimeTick(seconds: number): string {
  return `${seconds.toFixed(0)}s`;
}

function UtilizationLineChart({ data, jobTypes }: { data: DashboardDataPoint[]; jobTypes: JobTypeConfig[] }) {
  return (
    <ChartContainer>
      <SectionHeader subtitle="% of allocated slots actually in use">
        Job Type Utilization
      </SectionHeader>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="timeSeconds"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#888', fontSize: 10 }}
            tickFormatter={formatTimeTick}
          />
          <YAxis
            domain={[0, HUNDRED_PERCENT]}
            tick={{ fill: '#888', fontSize: 10 }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            formatter={(val: number, name: string) => [`${val}%`, name]}
            labelFormatter={(v) => `${Number(v).toFixed(1)}s`}
          />
          {jobTypes.map((jt) => (
            <Line
              key={jt.id}
              type="monotone"
              dataKey={`${jt.id}_utilization`}
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

function instanceTabClass(isActive: boolean): string {
  const base = 'px-3.5 py-1.5 rounded-md text-xs font-mono border transition-all';
  if (isActive) return `${base} bg-white/8 text-foreground border-white/15`;
  return `${base} text-muted-foreground border-white/6 hover:border-white/15 hover:text-muted-foreground/80 cursor-pointer`;
}

interface DynamicRatioChartProps {
  rawData: DashboardDataPoint[];
  jobTypes: JobTypeConfig[];
  instances: InstanceInfo[];
}

function DynamicRatioChart({ rawData, jobTypes, instances }: DynamicRatioChartProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = instances[selectedIdx] ?? instances[0];
  if (!selected) return null;

  return (
    <ChartContainer>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <SectionHeader subtitle="How resource share shifts with demand pressure">
          Dynamic Ratio Rebalancing
        </SectionHeader>
        {instances.length > 1 && (
          <div className="flex gap-1.5">
            {instances.map((inst, idx) => (
              <button key={inst.shortId} className={instanceTabClass(selectedIdx === idx)} onClick={() => setSelectedIdx(idx)}>
                {inst.shortId}
              </button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={rawData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="timeSeconds"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fill: '#888', fontSize: 10 }}
            tickFormatter={formatTimeTick}
          />
          <YAxis
            domain={[0, HUNDRED_PERCENT]}
            tick={{ fill: '#888', fontSize: 10 }}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            formatter={(val: number, name: string) => [`${val}%`, name]}
            labelFormatter={(v) => `${Number(v).toFixed(1)}s`}
          />
          {jobTypes.map((jt) => (
            <Area
              key={jt.id}
              type="monotone"
              dataKey={`${selected.shortId}_${jt.id}_ratio`}
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

export function AggregatedUtilizationCharts({ data, rawData, jobTypes, instances }: AggregatedUtilizationChartsProps) {
  if (data.length === 0 || jobTypes.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
      <UtilizationLineChart data={data} jobTypes={jobTypes} />
      <DynamicRatioChart rawData={rawData} jobTypes={jobTypes} instances={instances} />
    </div>
  );
}
