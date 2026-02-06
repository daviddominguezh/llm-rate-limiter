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

interface RateLimitChartsProps {
  data: DashboardDataPoint[];
  instances: InstanceInfo[];
  models: string[];
}

const CHART_HEIGHT = 200;
const THOUSAND = 1000;
const TOOLTIP_OFFSET = 10;

function formatTick(v: number): string {
  if (v >= THOUSAND) {
    return `${(v / THOUSAND).toFixed(0)}k`;
  }
  return String(v);
}

function RpmChart({ data, instances, models }: RateLimitChartsProps) {
  if (models.length === 0) return null;

  return (
    <ChartContainer>
      <SectionHeader subtitle="Requests per minute usage per model">
        RPM Usage
      </SectionHeader>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#888', fontSize: 10 }} tickFormatter={formatTick} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          {instances.flatMap((inst, instIdx) =>
            models.map((model, modelIdx) => (
              <Line
                key={`${inst.shortId}_${model}_rpm`}
                type="monotone"
                dataKey={`${inst.shortId}_${model}_rpm`}
                name={`${inst.shortId} ${model} RPM`}
                stroke={INSTANCE_COLORS[(instIdx + modelIdx) % INSTANCE_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function TpmChart({ data, instances, models }: RateLimitChartsProps) {
  if (models.length === 0) return null;

  return (
    <ChartContainer>
      <SectionHeader subtitle="Tokens per minute usage per model">
        TPM Usage
      </SectionHeader>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#888', fontSize: 10 }} tickFormatter={formatTick} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#eee', fontWeight: 600 }}
            position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
            allowEscapeViewBox={{ x: false, y: true }}
          />
          {instances.flatMap((inst, instIdx) =>
            models.map((model, modelIdx) => (
              <Line
                key={`${inst.shortId}_${model}_tpm`}
                type="monotone"
                dataKey={`${inst.shortId}_${model}_tpm`}
                name={`${inst.shortId} ${model} TPM`}
                stroke={INSTANCE_COLORS[(instIdx + modelIdx) % INSTANCE_COLORS.length]}
                strokeWidth={2}
                dot={false}
                strokeDasharray={instIdx > 0 ? '5 3' : undefined}
              />
            ))
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function RateLimitCharts({ data, instances, models }: RateLimitChartsProps) {
  if (data.length === 0 || models.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
      <RpmChart data={data} instances={instances} models={models} />
      <TpmChart data={data} instances={instances} models={models} />
    </div>
  );
}
