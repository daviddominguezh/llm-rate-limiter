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
  orange: { running: number; h: number };
  yellow: { queued: number; h: number };
  totalSlots: number;
}

const DEFAULT_HEIGHT = 80;
const MIN_ACTIVE_BAR_HEIGHT = 3;

// Colors
const ALLOCATED_COLOR = '#0000FF'; // Pure blue
const RUNNING_COLOR = '#FFA500'; // Orange - actively running
const QUEUED_COLOR = '#22C55E'; // Green - queued/waiting

interface ChartValues {
  running: number[];
  queued: number[];
  slots: number[];
  modelSlots: number[];
}

function extractNumericArray(data: CapacityDataPoint[], key: string | undefined): number[] {
  if (!key) return [];
  return data.map((d) => {
    const v = d[key];
    return typeof v === 'number' ? v : 0;
  });
}

function getValues(
  data: CapacityDataPoint[],
  runningKey: string,
  queuedKey: string,
  slotsKey: string | undefined,
  modelSlotsKey: string | undefined
): ChartValues {
  const running = extractNumericArray(data, runningKey);
  const queued = extractNumericArray(data, queuedKey);
  const slots = extractNumericArray(data, slotsKey);
  const modelSlots = extractNumericArray(data, modelSlotsKey);
  return { running, queued, slots, modelSlots };
}

function renderChart(
  ctx: CanvasRenderingContext2D,
  data: CapacityDataPoint[],
  values: ChartValues,
  width: number,
  height: number,
  timeExtent: [number, number],
  metricLabel: string
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

  const barLog: BarLog[] = [];

  for (let i = 0; i < data.length; i += 1) {
    const totalSlots = values.slots[i] ?? 0;
    const modelTotalSlots = values.modelSlots[i] ?? totalSlots;
    const runningVal = values.running[i];
    const queuedVal = values.queued[i];
    const barX = i * barWidth + i;

    // Blue bar uses model-level allocation (continuous across all job types)
    const blueHeight = modelTotalSlots > 0 ? height : 0;
    // Scale activity bars relative to model capacity
    const totalActive = runningVal + queuedVal;
    const activeScale = Math.max(modelTotalSlots, totalActive);
    const rawRunningH = activeScale > 0 ? (runningVal / activeScale) * height : 0;
    const runningH = runningVal > 0 ? Math.max(MIN_ACTIVE_BAR_HEIGHT, rawRunningH) : 0;
    const rawQueuedH = activeScale > 0 ? (queuedVal / activeScale) * height : 0;
    const queuedH = queuedVal > 0 ? Math.max(MIN_ACTIVE_BAR_HEIGHT, rawQueuedH) : 0;

    // Draw blue (allocated capacity)
    ctx.fillStyle = ALLOCATED_COLOR;
    ctx.fillRect(barX, height - blueHeight, barWidth, blueHeight);

    // Draw green (queued) stacked above orange
    ctx.fillStyle = QUEUED_COLOR;
    ctx.fillRect(barX, height - runningH - queuedH, barWidth, queuedH);

    // Draw orange (running) - from bottom up to running height
    ctx.fillStyle = RUNNING_COLOR;
    ctx.fillRect(barX, height - runningH, barWidth, runningH);

    barLog.push({
      i,
      x: barX,
      w: barWidth,
      blue: { slots: totalSlots, h: blueHeight },
      orange: { running: runningVal, h: runningH },
      yellow: { queued: queuedVal, h: queuedH },
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
}

/** Resolve slots: prefer per-job-type, fall back to model-level */
function resolveSlots(point: CapacityDataPoint | undefined, metric: CapacityMetric): number | null {
  if (!point) return null;
  const perJT = metric.slotsKey ? point[metric.slotsKey] : undefined;
  if (typeof perJT === 'number') return perJT;
  const model = metric.modelSlotsKey ? point[metric.modelSlotsKey] : undefined;
  return typeof model === 'number' ? model : null;
}

/** Find last non-zero slots value scanning backward from interval 399 */
function findLastNonZeroSlots(data: CapacityDataPoint[], metric: CapacityMetric): number | null {
  const keys = [metric.slotsKey, metric.modelSlotsKey].filter(Boolean);
  for (let i = 399; i >= 0; i -= 1) {
    for (const key of keys) {
      const v = key ? data[i]?.[key] : undefined;
      if (typeof v === 'number' && v > 0) return v;
    }
  }
  return null;
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

    const values = getValues(data, metric.usageKey, metric.queuedKey, metric.slotsKey, metric.modelSlotsKey);
    renderChart(ctx, data, values, containerWidth, height, timeExtent, metric.label);
  }, [data, metric, height, containerWidth, timeExtent]);

  // Clamp displayIndex to valid data range (focusIndex can be beyond for fill bars)
  const displayIndex = Math.min(focusIndex ?? data.length - 1, data.length - 1);
  const isPaddingOrFill = (focusIndex ?? 0) >= 400;

  let runningVal = 0;
  let queuedVal = 0;
  let slotsVal: number | null = null;

  if (isPaddingOrFill) {
    // For padding/fill bars, show 0 used and last non-zero allocated
    runningVal = 0;
    queuedVal = 0;
    slotsVal = findLastNonZeroSlots(data, metric);
  } else {
    const currentRunning = data[displayIndex]?.[metric.usageKey];
    const currentQueued = data[displayIndex]?.[metric.queuedKey];
    runningVal = typeof currentRunning === 'number' ? currentRunning : 0;
    queuedVal = typeof currentQueued === 'number' ? currentQueued : 0;
    slotsVal = resolveSlots(data[displayIndex], metric);
  }

  return (
    <div className="flex items-stretch border-t border-border pr-2" style={{ minHeight: height }}>
      <div ref={containerRef} className="flex-1 min-w-0 relative ml-1">
        <canvas ref={canvasRef} height={height} className="w-full block" />
        <div
          className="absolute top-1 right-2 text-xs tabular-nums"
          style={{ color: 'white', fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span style={{ color: RUNNING_COLOR, fontWeight: 600 }}>{formatValue(runningVal)}</span>
          <span style={{ color: 'white' }}> run</span>
          {queuedVal > 0 && (
            <>
              <span style={{ color: 'white' }}> + </span>
              <span style={{ color: QUEUED_COLOR, fontWeight: 600 }}>{formatValue(queuedVal)}</span>
              <span style={{ color: 'white' }}> queue</span>
            </>
          )}
          <span style={{ color: 'white' }}> / </span>
          <span style={{ color: 'white' }}>{slotsVal !== null ? formatValue(slotsVal) : '?'}</span>
          <span style={{ color: 'white' }}> alloc</span>
        </div>
      </div>
    </div>
  );
}
