'use client';

import type { CapacityDataPoint, CapacityMetric } from '@/lib/timeseries/capacityTypes';
import { useEffect, useRef, useState } from 'react';

interface CapacityChartProps {
  data: CapacityDataPoint[];
  metric: CapacityMetric;
  height?: number;
  focusIndex?: number | null;
  timeExtent: [number, number];
}

interface BarLog {
  i: number;
  x: number;
  w: number;
  blue: { slots: number; h: number };
  orange: { inFlight: number; h: number };
  totalSlots: number;
}

const DEFAULT_HEIGHT = 80;

// Colors
const ALLOCATED_COLOR = '#0000FF'; // Pure blue
const USED_COLOR = '#FFA500'; // Pure orange

interface ChartValues {
  inFlight: number[];
  slots: number[];
}

function getValues(
  data: CapacityDataPoint[],
  inFlightKey: string,
  slotsKey: string | undefined
): ChartValues {
  const inFlight = data.map((d) => {
    const v = d[inFlightKey];
    return typeof v === 'number' ? v : 0;
  });
  const slots = slotsKey
    ? data.map((d) => {
        const v = d[slotsKey];
        return typeof v === 'number' ? v : 0;
      })
    : [];
  return { inFlight, slots };
}

function renderChart(
  ctx: CanvasRenderingContext2D,
  data: CapacityDataPoint[],
  values: ChartValues,
  width: number,
  height: number,
  timeExtent: [number, number]
): void {
  const [minTime, maxTime] = timeExtent;
  const timeRange = maxTime - minTime;

  ctx.clearRect(0, 0, width, height);

  // Ensure no shadows or strokes
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  if (timeRange === 0 || data.length === 0) return;

  const barWidth = Math.floor(width / data.length) - 1;
  console.log(barWidth);

  const barLog: BarLog[] = [];

  for (let i = 0; i < data.length; i += 1) {
    const totalSlots = values.slots[i] ?? 0;
    const inFlightVal = values.inFlight[i];
    const barX = i * barWidth + i;

    // Blue bar is always full height (shows capacity)
    const blueHeight = totalSlots > 0 ? height : 0;
    // Orange bar scales relative to this interval's totalSlots
    const orangeHeight = totalSlots > 0 ? (inFlightVal / totalSlots) * height : 0;

    // Draw blue (allocated)
    ctx.fillStyle = ALLOCATED_COLOR;
    ctx.fillRect(barX, height - blueHeight, barWidth, blueHeight);

    // Draw orange (used) on top
    ctx.fillStyle = USED_COLOR;
    ctx.fillRect(barX, height - orangeHeight, barWidth, orangeHeight);

    barLog.push({
      i,
      x: barX,
      w: barWidth,
      blue: { slots: totalSlots, h: blueHeight },
      orange: { inFlight: inFlightVal, h: orangeHeight },
      totalSlots,
    });
  }

  // Fill remaining space with blue bars using last non-zero blue height
  const n = data.length;
  const step = barWidth + 1;

  // Find last bar with non-zero blue height
  let lastVisibleIndex = -1;
  let lastBlueHeight = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (barLog[i].blue.h > 0) {
      lastVisibleIndex = i;
      lastBlueHeight = barLog[i].blue.h;
      break;
    }
  }

  // Draw additional bars starting right after the last visible bar
  if (lastVisibleIndex >= 0 && lastBlueHeight > 0) {
    let extraBarIndex = lastVisibleIndex + 1;
    let extraBarX = extraBarIndex * step;
    while (extraBarX + barWidth <= width) {
      ctx.fillStyle = ALLOCATED_COLOR;
      ctx.fillRect(extraBarX, height - lastBlueHeight, barWidth, lastBlueHeight);
      extraBarIndex += 1;
      extraBarX = extraBarIndex * step;
    }
  }
  // console.log('bars:', barLog);
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(1);
}

export function CapacityChart({
  data,
  metric,
  height = DEFAULT_HEIGHT,
  focusIndex,
  timeExtent,
}: CapacityChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

    const values = getValues(data, metric.usageKey, metric.slotsKey);
    renderChart(ctx, data, values, containerWidth, height, timeExtent);
  }, [data, metric, height, containerWidth, timeExtent]);

  const displayIndex = focusIndex ?? data.length - 1;
  const currentInFlight = data[displayIndex]?.[metric.usageKey];
  const currentSlots = metric.slotsKey ? data[displayIndex]?.[metric.slotsKey] : undefined;
  const inFlightVal = typeof currentInFlight === 'number' ? currentInFlight : 0;
  const slotsVal = typeof currentSlots === 'number' ? currentSlots : null;

  return (
    <div className="flex items-stretch border-t border-border pr-2" style={{ minHeight: height }}>
      <div ref={containerRef} className="flex-1 min-w-0 relative ml-1">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-xs tabular-nums"
          style={{ color: 'white', fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span style={{ color: 'white', fontWeight: 600 }}>{formatValue(inFlightVal)}</span>
          <span style={{ color: 'white' }}> used</span>
          <span style={{ color: 'white' }}> / </span>
          <span style={{ color: 'white' }}>{slotsVal !== null ? formatValue(slotsVal) : '?'}</span>
          <span style={{ color: 'white' }}> allocated</span>
        </div>
      </div>
    </div>
  );
}
