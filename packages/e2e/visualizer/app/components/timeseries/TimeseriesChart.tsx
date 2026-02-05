'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import type { ChartDataPoint, MetricConfig } from '@/lib/timeseries';

interface TimeseriesChartProps {
  data: ChartDataPoint[];
  selectedMetrics: string[];
  metricConfigs: MetricConfig[];
}

function getConfigForMetric(
  metricKey: string,
  configs: MetricConfig[]
): MetricConfig | undefined {
  return configs.find((c) => c.key === metricKey);
}

export function TimeseriesChart({
  data,
  selectedMetrics,
  metricConfigs,
}: TimeseriesChartProps) {
  if (data.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="time"
          label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }}
          className="text-xs"
        />
        <YAxis className="text-xs" />
        <Tooltip
          content={<ChartTooltip metricConfigs={metricConfigs} />}
        />
        <Legend />
        {selectedMetrics.map((metricKey) => {
          const config = getConfigForMetric(metricKey, metricConfigs);
          return (
            <Line
              key={metricKey}
              type="monotone"
              dataKey={metricKey}
              name={config?.label ?? metricKey}
              stroke={config?.color ?? '#888'}
              dot={false}
              strokeWidth={2}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
