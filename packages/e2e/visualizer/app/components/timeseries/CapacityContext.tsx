'use client';

import type { CapacityDataPoint, InstanceConfig } from '@/lib/timeseries/capacityTypes';
import type { HighwayInstanceConfig } from '@/lib/timeseries/highwayTypes';
import * as d3 from 'd3';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { HighwayInstanceSection } from './HighwayInstanceSection';
import { InstanceSection } from './InstanceSection';

interface CapacityContextProps {
  data: CapacityDataPoint[];
  instances: InstanceConfig[];
  highwayInstances?: HighwayInstanceConfig[];
  onFocusChange?: (index: number | null) => void;
}

function getTimeExtent(data: CapacityDataPoint[]): [number, number] {
  if (data.length === 0) return [0, 1];
  const times = data.map((d) => d.time);
  return [Math.min(...times), Math.max(...times)];
}

// Left margin matches ml-1 in CapacityChart (1 * 4px = 4px)
const LEFT_MARGIN = 4;
// Right padding matches pr-2 in CapacityChart (2 * 4px = 8px)
const RIGHT_PADDING = 8;

export function CapacityContext({ data, instances, highwayInstances, onFocusChange }: CapacityContextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<SVGSVGElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
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
    const svg = axisRef.current;
    if (!svg || containerWidth === 0 || data.length === 0) return;

    const chartWidth = containerWidth - LEFT_MARGIN - RIGHT_PADDING;
    if (chartWidth <= 0) return;

    const [minTime, maxTime] = getTimeExtent(data);
    const scale = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
    const axis = d3
      .axisBottom(scale)
      .ticks(10)
      .tickFormat((d) => `${d}s`);

    d3.select(svg).selectAll('*').remove();
    d3.select(svg).append('g').attr('transform', `translate(${LEFT_MARGIN}, 0)`).call(axis);
  }, [data, containerWidth]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || data.length === 0 || containerWidth === 0) return;

      const chartWidth = containerWidth - LEFT_MARGIN - RIGHT_PADDING;
      if (chartWidth <= 0) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left - LEFT_MARGIN;
      if (x < 0) return;

      // Match bar positioning: barX = i * barWidth + i
      const barWidth = Math.floor(chartWidth / data.length) - 1;
      const step = barWidth + 1;
      // Allow cursor to move across full width (including fill bars)
      const index = Math.floor(x / step);
      // Clamp data index to valid range, but allow visual position beyond
      const clampedIndex = Math.max(0, Math.min(index, data.length - 1));

      setFocusIndex(index); // Use unclamped index for cursor position
      onFocusChange?.(clampedIndex); // Use clamped index for data
    },
    [containerWidth, data, onFocusChange]
  );

  const handleMouseLeave = useCallback(() => {
    setFocusIndex(null);
    onFocusChange?.(null);
  }, [onFocusChange]);

  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-muted-foreground">No data available</div>
    );
  }

  return (
    <div className="space-y-0">
      <div
        ref={containerRef}
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="space-y-0">
          {instances.map((instance) => {
            const hwConfig = highwayInstances?.find((h) => h.instanceId === instance.instanceId);
            return (
              <Fragment key={instance.instanceId}>
                {hwConfig && (
                  <HighwayInstanceSection
                    config={hwConfig}
                    data={data}
                    focusIndex={focusIndex}
                    timeExtent={getTimeExtent(data)}
                  />
                )}
                <InstanceSection
                  config={instance}
                  data={data}
                  focusIndex={focusIndex}
                  timeExtent={getTimeExtent(data)}
                />
              </Fragment>
            );
          })}
        </div>

        {focusIndex !== null &&
          containerWidth > LEFT_MARGIN &&
          (() => {
            const chartWidth = containerWidth - LEFT_MARGIN - RIGHT_PADDING;
            const barWidth = Math.floor(chartWidth / data.length) - 1;
            const step = barWidth + 1;
            // Position cursor at the center of the bar (can be beyond data.length for fill bars)
            const xPos = Math.min(
              LEFT_MARGIN + focusIndex * step + barWidth / 2,
              containerWidth - RIGHT_PADDING
            );
            return (
              <div
                className="absolute top-0 bottom-0 w-px bg-foreground/50 pointer-events-none z-10"
                style={{ left: `${xPos}px` }}
              />
            );
          })()}
      </div>

      <div>
        <svg ref={axisRef} width={containerWidth} height={30} className="text-sm" />
      </div>
    </div>
  );
}

export interface FocusInfoProps {
  focusData: CapacityDataPoint | null;
  isHovering: boolean;
}

export function FocusInfo({ focusData, isHovering }: FocusInfoProps) {
  if (!focusData) return null;
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className={isHovering ? 'text-foreground font-medium' : 'text-muted-foreground'}>
        Time: {focusData.time.toFixed(2)}s
      </span>
    </div>
  );
}
