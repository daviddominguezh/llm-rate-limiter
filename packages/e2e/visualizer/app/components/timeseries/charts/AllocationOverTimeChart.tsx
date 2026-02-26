'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DashboardDataPoint, ResourceType } from '@/lib/timeseries/dashboardTypes';
import { ALL_RESOURCE_TYPES, MODEL_COLORS, TOOLTIP_STYLE } from '@/lib/timeseries/dashboardTypes';

import { ChartContainer, SectionHeader } from '../DashboardComponents';

interface ChartSeries {
  allocKey: string;
  usedKey: string;
  label: string;
  color: string;
}

interface AllocationOverTimeChartProps {
  data: DashboardDataPoint[];
  models: string[];
  enabledResourceTypes: Set<ResourceType>;
}

const CHART_HEIGHT = 320;
const THOUSAND = 1000;

function getResourceSuffix(type: ResourceType): { used: string; capacity: string } | null {
  switch (type) {
    case 'RPM':
      return { used: 'rpm', capacity: 'rpmCapacity' };
    case 'TPM':
      return { used: 'tpm', capacity: 'tpmCapacity' };
    case 'Concurrent':
      return { used: 'concurrent', capacity: 'concurrentCapacity' };
    default:
      return null;
  }
}

function buildSeries(
  resourceType: ResourceType,
  models: string[],
  data: DashboardDataPoint[]
): ChartSeries[] {
  const suffixes = getResourceSuffix(resourceType);
  if (!suffixes) return [];

  return models
    .map((model, idx) => ({
      allocKey: `${model}_${suffixes.capacity}`,
      usedKey: `${model}_${suffixes.used}`,
      label: model.replace(/_/gu, '-'),
      color: MODEL_COLORS[idx % MODEL_COLORS.length],
    }))
    .filter((s) => data.some((point) => (point[s.usedKey] as number) > 0));
}

function formatValueTick(v: number): string {
  return v >= THOUSAND ? `${(v / THOUSAND).toFixed(0)}k` : String(v);
}

function formatTimeTick(seconds: number): string {
  return `${seconds.toFixed(0)}s`;
}

function ResourceTypeTabs({
  selected,
  onSelect,
  enabledTypes,
}: {
  selected: ResourceType;
  onSelect: (type: ResourceType) => void;
  enabledTypes: Set<ResourceType>;
}) {
  return (
    <div className="flex gap-1.5">
      {ALL_RESOURCE_TYPES.map((type) => {
        const isEnabled = enabledTypes.has(type);
        const isActive = selected === type;
        return (
          <button
            key={type}
            disabled={!isEnabled}
            onClick={() => onSelect(type)}
            className={[
              'px-3.5 py-1.5 rounded-md text-xs font-mono border transition-all',
              isActive ? 'bg-white/8 text-foreground border-white/15' : '',
              !isActive && isEnabled
                ? 'text-muted-foreground border-white/6 hover:border-white/15 hover:text-muted-foreground/80 cursor-pointer'
                : '',
              !isEnabled ? 'text-muted-foreground/30 border-white/3 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {type}
          </button>
        );
      })}
    </div>
  );
}

function CustomTooltipContent({
  active,
  label,
  payload,
  series,
}: {
  active?: boolean;
  label?: number;
  payload?: Array<{ dataKey: string; value: number }>;
  series: ChartSeries[];
}) {
  if (!active || !payload || payload.length === 0) return null;

  const valuesByKey = new Map<string, number>();
  for (const entry of payload) {
    valuesByKey.set(entry.dataKey, entry.value);
  }

  return (
    <div style={TOOLTIP_STYLE}>
      <p style={{ color: '#eee', fontWeight: 600, marginBottom: '6px' }}>{Number(label).toFixed(1)}s</p>
      {series.map((s) => {
        const used = valuesByKey.get(s.usedKey) ?? 0;
        const capacity = valuesByKey.get(s.allocKey) ?? 0;
        return (
          <p key={s.label} style={{ color: s.color, margin: '2px 0', fontSize: 12 }}>
            {s.label}: {formatValueTick(used)}/{formatValueTick(capacity)}
          </p>
        );
      })}
    </div>
  );
}

function AllocationAreaChart({ data, series }: { data: DashboardDataPoint[]; series: ChartSeries[] }) {
  if (series.length === 0) {
    return (
      <div className="flex items-center justify-center h-[320px] text-muted-foreground/50 text-sm font-mono">
        No data available for this resource type
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
        <XAxis
          dataKey="timeSeconds"
          type="number"
          domain={['dataMin', 'dataMax']}
          tick={{ fill: '#888', fontSize: 10 }}
          tickFormatter={formatTimeTick}
        />
        <YAxis tick={{ fill: '#888', fontSize: 10 }} tickFormatter={formatValueTick} />
        <Tooltip content={<CustomTooltipContent series={series} />} />
        {series.map((s) => (
          <Area
            key={s.allocKey}
            type="monotone"
            dataKey={s.allocKey}
            name={`${s.label} Capacity`}
            fill={s.color}
            fillOpacity={0.15}
            stroke={s.color}
            strokeWidth={1.5}
            strokeOpacity={0.4}
            strokeDasharray="4 3"
            activeDot={false}
          />
        ))}
        {series.map((s) => (
          <Area
            key={s.usedKey}
            type="monotone"
            dataKey={s.usedKey}
            name={`${s.label} Used`}
            fill={s.color}
            fillOpacity={0.4}
            stroke={s.color}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChartLegend() {
  return (
    <div className="flex gap-6 justify-center mt-2 text-[11px] font-mono">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block w-5 h-0.5 bg-muted-foreground/40" />
        Capacity (faded)
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-block w-5 h-0.5 bg-muted-foreground" />
        Actual Usage (solid)
      </span>
    </div>
  );
}

export function AllocationOverTimeChart({
  data,
  models,
  enabledResourceTypes,
}: AllocationOverTimeChartProps) {
  const firstEnabled = ALL_RESOURCE_TYPES.find((t) => enabledResourceTypes.has(t));
  const [selectedResource, setSelectedResource] = useState<ResourceType>(firstEnabled ?? 'TPM');

  if (data.length === 0) return null;

  const series = buildSeries(selectedResource, models, data);

  return (
    <ChartContainer>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <SectionHeader subtitle="Resource capacity and usage across all instances — stacked by model">
          Resource Allocation Over Time
        </SectionHeader>
        <ResourceTypeTabs
          selected={selectedResource}
          onSelect={setSelectedResource}
          enabledTypes={enabledResourceTypes}
        />
      </div>

      <AllocationAreaChart data={data} series={series} />
      <ChartLegend />
    </ChartContainer>
  );
}
