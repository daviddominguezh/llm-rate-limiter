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
const TOOLTIP_OFFSET = 10;
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

function buildSeries(resourceType: ResourceType, models: string[]): ChartSeries[] {
  const suffixes = getResourceSuffix(resourceType);
  if (!suffixes) return [];

  return models.map((model, idx) => ({
    allocKey: `${model}_${suffixes.capacity}`,
    usedKey: `${model}_${suffixes.used}`,
    label: model.replace(/_/gu, '-'),
    color: MODEL_COLORS[idx % MODEL_COLORS.length],
  }));
}

function formatTick(v: number): string {
  return v >= THOUSAND ? `${(v / THOUSAND).toFixed(0)}k` : String(v);
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
        <XAxis dataKey="time" tick={{ fill: '#888', fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fill: '#888', fontSize: 10 }} tickFormatter={formatTick} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: '#eee', fontWeight: 600, marginBottom: '6px' }}
          position={{ y: CHART_HEIGHT + TOOLTIP_OFFSET }}
          allowEscapeViewBox={{ x: false, y: true }}
        />
        {series.map((s) => (
          <Area
            key={s.allocKey}
            type="monotone"
            dataKey={s.allocKey}
            name={`${s.label} Capacity`}
            stackId="alloc"
            fill={s.color}
            fillOpacity={0.2}
            stroke={s.color}
            strokeWidth={1.5}
            strokeOpacity={0.6}
          />
        ))}
        {series.map((s) => (
          <Area
            key={s.usedKey}
            type="monotone"
            dataKey={s.usedKey}
            name={`${s.label} Used`}
            stackId="used"
            fill={s.color}
            fillOpacity={0.5}
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

  const series = buildSeries(selectedResource, models);

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
