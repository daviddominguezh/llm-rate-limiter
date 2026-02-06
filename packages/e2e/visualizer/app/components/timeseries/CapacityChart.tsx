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

const DEFAULT_HEIGHT = 80;

// Colors for capacity visualization (matching ResourceDashboard)
const USAGE_COLOR = '#E8715A';
const CAPACITY_COLOR = 'rgba(255,255,255,0.1)';

function getValues(
  data: CapacityDataPoint[],
  usageKey: string,
  capacityKey: string
): { usage: number[]; capacity: number[] } {
  const usage = data.map((d) => {
    const v = d[usageKey];
    return typeof v === 'number' ? v : 0;
  });
  const capacity = data.map((d) => {
    const v = d[capacityKey];
    return typeof v === 'number' ? v : 0;
  });
  return { usage, capacity };
}

function renderCapacityBars(
  ctx: CanvasRenderingContext2D,
  data: CapacityDataPoint[],
  usage: number[],
  capacity: number[],
  width: number,
  height: number,
  timeExtent: [number, number]
): void {
  const [minTime, maxTime] = timeExtent;
  const timeRange = maxTime - minTime;
  const maxCapacity = Math.max(...capacity, 1);

  ctx.clearRect(0, 0, width, height);

  if (timeRange === 0) return;

  // Draw bars at time-based positions
  for (let i = 0; i < data.length; i += 1) {
    const point = data[i];
    const usageVal = usage[i];
    const capacityVal = capacity[i];

    // Calculate x position based on time
    const xRatio = (point.time - minTime) / timeRange;
    const x = xRatio * width;

    // Calculate bar width to extend to next point (or end)
    let barWidth: number;
    if (i < data.length - 1) {
      const nextXRatio = (data[i + 1].time - minTime) / timeRange;
      barWidth = (nextXRatio - xRatio) * width;
    } else {
      barWidth = width - x;
    }

    // Draw capacity background
    const capacityHeight = (capacityVal / maxCapacity) * height;
    ctx.fillStyle = CAPACITY_COLOR;
    ctx.fillRect(x, height - capacityHeight, barWidth, capacityHeight);

    // Draw usage fill
    const usageHeight = (usageVal / maxCapacity) * height;
    ctx.fillStyle = USAGE_COLOR;
    ctx.fillRect(x, height - usageHeight, barWidth, usageHeight);
  }
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

    const { usage, capacity } = getValues(data, metric.usageKey, metric.capacityKey);
    renderCapacityBars(ctx, data, usage, capacity, containerWidth, height, timeExtent);
  }, [data, metric, height, containerWidth, timeExtent]);

  const displayIndex = focusIndex ?? data.length - 1;
  const currentUsage = data[displayIndex]?.[metric.usageKey];
  const currentCapacity = data[displayIndex]?.[metric.capacityKey];
  const usageVal = typeof currentUsage === 'number' ? currentUsage : 0;
  const capacityVal = typeof currentCapacity === 'number' ? currentCapacity : 0;

  return (
    <div className="flex items-stretch border-t border-border pr-2" style={{ minHeight: height }}>
      <div
        className="w-40 flex items-center px-3 bg-muted/30 border-r border-border"
        style={{ textShadow: '0 1px 0 rgba(255,255,255,.5)' }}
      >
        <div
          title={metric.label}
          style={{
            fontSize: '12px',
            color: '#555',
            margin: '4px 0 0',
            fontFamily: 'monospace',
            outline: 0,
            border: 0,
            textShadow: 'none'
          }}
        >
          {metric.label}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-w-0 relative">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-sm font-semibold tabular-nums"
          style={{ textShadow: '0 1px 0 rgba(255,255,255,.8)' }}
        >
          {formatValue(usageVal)} / {formatValue(capacityVal)}
        </div>
      </div>
    </div>
  );
}
