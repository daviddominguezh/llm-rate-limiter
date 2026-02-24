'use client';

import type { CapacityDataPoint } from '@/lib/timeseries/capacityTypes';
import type { HighwayConfig, HighwayValues } from '@/lib/timeseries/highwayTypes';
import { extractHighwayValues } from '@/lib/timeseries/highwayTransform';
import { useEffect, useRef, useState } from 'react';

import { renderHighway } from './highwayChartRenderer';

interface HighwayChartProps {
  data: CapacityDataPoint[];
  highway: HighwayConfig;
  height?: number;
  focusIndex?: number | null;
  timeExtent: [number, number];
}

const DEFAULT_HEIGHT = 160;
const NUM_INTERVALS = 400;

/** Get the display index clamped to data range */
function getDisplayIndex(focusIndex: number | null, dataLength: number): number {
  return Math.min(focusIndex ?? dataLength - 1, dataLength - 1);
}

/** Check if focus is on a padding/fill bar beyond interval range */
function isPaddingBar(focusIndex: number | null): boolean {
  return (focusIndex ?? 0) >= NUM_INTERVALS;
}

/** Format a count value for display */
function formatCount(value: number): string {
  return value.toString();
}

/** Build overlay text for a single lane at the focused interval */
function buildLaneOverlay(
  highway: HighwayConfig,
  values: HighwayValues,
  displayIndex: number,
  padding: boolean
): string[] {
  return highway.lanes.map((lane, i) => {
    const running = padding ? 0 : values.lanes[i].running[displayIndex];
    const slots = values.lanes[i].slots[displayIndex];
    return `${lane.jobType}: ${formatCount(running)}/${formatCount(slots)}`;
  });
}

export function HighwayChart({
  data,
  highway,
  height = DEFAULT_HEIGHT,
  focusIndex,
  timeExtent,
}: HighwayChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const valuesRef = useRef<HighwayValues | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (): void => {
      setContainerWidth(container.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth === 0 || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = containerWidth;
    canvas.height = height;

    const values = extractHighwayValues(data, highway);
    valuesRef.current = values;

    console.log('[HighwayChart]', highway.modelLabel, {
      highway,
      modelSlots: values.modelSlots.slice(0, 10),
      lanes: values.lanes.map((l, i) => ({
        jobType: highway.lanes[i].jobType,
        slots: l.slots.slice(0, 10),
        running: l.running.slice(0, 10),
        queued: l.queued.slice(0, 10),
      })),
      containerWidth,
      height,
      dataLength: data.length,
    });

    renderHighway(ctx, values, highway, containerWidth, height, data.length);
  }, [data, highway, height, containerWidth, timeExtent]);

  const displayIndex = getDisplayIndex(focusIndex, data.length);
  const padding = isPaddingBar(focusIndex);
  const values = valuesRef.current;
  const overlayParts = values ? buildLaneOverlay(highway, values, displayIndex, padding) : [];

  return (
    <div className="flex items-stretch border-t border-border pr-2" style={{ minHeight: height }}>
      <div ref={containerRef} className="flex-1 min-w-0 relative ml-1">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-xs tabular-nums"
          style={{ color: 'white', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {overlayParts.map((text) => (
            <span key={text} className="mr-2">
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
