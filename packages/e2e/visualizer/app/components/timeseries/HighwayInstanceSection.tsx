'use client';

import type { CapacityDataPoint } from '@/lib/timeseries/capacityTypes';
import type { HighwayConfig, HighwayInstanceConfig, HighwayValues } from '@/lib/timeseries/highwayTypes';
import { extractHighwayValues } from '@/lib/timeseries/highwayTransform';

import { HighwayChart } from './HighwayChart';

interface HighwayInstanceSectionProps {
  config: HighwayInstanceConfig;
  data: CapacityDataPoint[];
  focusIndex: number | null;
  timeExtent: [number, number];
}

/** Minimum chart height for the smallest highway */
const MIN_CHART_HEIGHT = 20;

/** Check if a highway has any running jobs across all lanes */
function hasActivity(data: CapacityDataPoint[], highway: HighwayConfig): boolean {
  for (const lane of highway.lanes) {
    for (const point of data) {
      const v = point[lane.runningKey];
      if (typeof v === 'number' && v > 0) return true;
    }
  }
  return false;
}

/** Find the peak model slots value across all intervals for a highway */
function peakModelSlots(data: CapacityDataPoint[], highway: HighwayConfig): number {
  let peak = 0;
  for (const point of data) {
    const v = point[highway.modelSlotsKey];
    if (typeof v === 'number' && v > peak) peak = v;
  }
  return peak;
}

/** Compute strictly proportional heights: smallest model = MIN_CHART_HEIGHT, others scale up */
function computeScaledHeights(
  highways: HighwayConfig[],
  data: CapacityDataPoint[]
): Map<string, number> {
  const peaks = highways.map((h) => peakModelSlots(data, h));
  const minPeak = Math.max(Math.min(...peaks), 1);
  const pixelsPerSlot = MIN_CHART_HEIGHT / minPeak;
  const heights = new Map<string, number>();

  highways.forEach((h, i) => {
    heights.set(h.modelKey, Math.round(peaks[i] * pixelsPerSlot));
  });

  return heights;
}

/** Render the lane legend for a highway */
function LaneLegend({ highway, data }: { highway: HighwayConfig; data: CapacityDataPoint[] }) {
  const values: HighwayValues = extractHighwayValues(data, highway);
  const activeLanes = highway.lanes.filter((_, i) => {
    return values.lanes[i].running.some((v) => v > 0) || values.lanes[i].slots.some((v) => v > 0);
  });

  return (
    <div className="flex gap-3 px-4 py-1 flex-wrap">
      {activeLanes.map((lane) => (
        <div key={lane.jobType} className="flex items-center gap-1 text-xs text-muted-foreground">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: lane.color }} />
          {lane.jobType}
        </div>
      ))}
    </div>
  );
}

export function HighwayInstanceSection({
  config,
  data,
  focusIndex,
  timeExtent,
}: HighwayInstanceSectionProps) {
  const activeHighways = config.highways.filter((h) => hasActivity(data, h));

  if (activeHighways.length === 0) return null;

  const scaledHeights = computeScaledHeights(activeHighways, data);

  return (
    <div className="border border-border rounded-none overflow-hidden">
      <div className="flex gap-4 items-center bg-muted px-4 py-2 border-b border-border">
        <h3 className="font-semibold text-base">{config.instanceId} - Highway View</h3>
        <p className="text-xs text-muted-foreground truncate">{config.fullId}</p>
      </div>

      {activeHighways.map((highway) => (
        <div className="w-full flex flex-col" key={highway.modelKey}>
          <div className="w-full flex justify-between items-center bg-muted/30 border-b border-t border-border px-4">
            <div
              title={highway.modelLabel}
              style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}
            >
              {highway.modelLabel}
            </div>
            <LaneLegend highway={highway} data={data} />
          </div>
          <HighwayChart
            data={data}
            highway={highway}
            height={scaledHeights.get(highway.modelKey) ?? MIN_CHART_HEIGHT}
            focusIndex={focusIndex}
            timeExtent={timeExtent}
          />
        </div>
      ))}
    </div>
  );
}
