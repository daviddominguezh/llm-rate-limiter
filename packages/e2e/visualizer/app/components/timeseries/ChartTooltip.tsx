'use client';

import type { TooltipProps } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import type { MetricConfig } from '@/lib/timeseries';

interface ChartTooltipProps extends TooltipProps<number, string> {
  metricConfigs: MetricConfig[];
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatValue(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

export function ChartTooltip({
  active,
  payload,
  metricConfigs,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload as Record<string, number | string> | undefined;
  if (!data) return null;

  const timestamp = data.timestamp as number;
  const trigger = data.trigger as string;
  const time = data.time as number;

  return (
    <Card className="z-50">
      <CardContent className="p-2 space-y-1">
        <TooltipHeader time={time} timestamp={timestamp} trigger={trigger} />
        <TooltipMetrics payload={payload} metricConfigs={metricConfigs} />
      </CardContent>
    </Card>
  );
}

interface TooltipHeaderProps {
  time: number;
  timestamp: number;
  trigger: string;
}

function TooltipHeader({ time, timestamp, trigger }: TooltipHeaderProps) {
  const shortTrigger = trigger.length > 30 ? `${trigger.slice(0, 30)}...` : trigger;
  return (
    <div className="border-b pb-1 mb-1">
      <div className="text-xs font-medium">
        {time.toFixed(2)}s ({formatTimestamp(timestamp)})
      </div>
      <div className="text-xs text-muted-foreground">{shortTrigger}</div>
    </div>
  );
}

interface TooltipMetricsProps {
  payload: TooltipProps<number, string>['payload'];
  metricConfigs: MetricConfig[];
}

function TooltipMetrics({ payload, metricConfigs }: TooltipMetricsProps) {
  const configMap = new Map(metricConfigs.map((m) => [m.key, m]));

  return (
    <div className="space-y-0.5">
      {payload?.map((entry) => {
        const config = configMap.get(entry.dataKey as string);
        const value = entry.value as number | undefined;
        if (value === undefined) return null;

        return (
          <div key={entry.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">
              {config?.label ?? entry.dataKey}:
            </span>
            <span className="font-medium">{formatValue(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
