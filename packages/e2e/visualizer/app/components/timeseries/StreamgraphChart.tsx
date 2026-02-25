'use client';

import { buildStreamgraphPanels } from '@/lib/timeseries/streamgraphTransform';
import type { StreamgraphPanel, StreamgraphStream } from '@/lib/timeseries/streamgraphTransform';
import type { StructuredCapacityResult } from '@/lib/timeseries/structuredTransform';
import * as d3 from 'd3';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  applyTransitions,
  buildColorMap,
  computeLayout,
  DEFAULT_DIMENSIONS,
  highlightStream,
  renderAxis,
  renderCapacityPaths,
  renderPaths,
} from './streamgraphHelpers';

// =============================================================================
// Types
// =============================================================================

interface StreamgraphChartProps {
  data: StructuredCapacityResult;
  height?: number;
}

interface TooltipState {
  stream: StreamgraphStream;
  x: number;
  y: number;
}

// =============================================================================
// Constants
// =============================================================================

const MIN_WIDTH = 100;

// =============================================================================
// Main component — renders one panel per (instance, model)
// =============================================================================

export function StreamgraphChart({ data, height: propHeight }: StreamgraphChartProps) {
  const panels = useMemo(() => buildStreamgraphPanels(data), [data]);

  if (panels.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>;
  }

  const legend = panels[0].streams;

  return (
    <div className="space-y-2">
      {panels.map((panel) => (
        <StreamgraphPanel
          key={`${panel.instanceId}|${panel.modelId}`}
          panel={panel}
          height={propHeight}
        />
      ))}
      <StreamLegend streams={legend} />
    </div>
  );
}

// =============================================================================
// Single panel — one SVG for one (instance, model)
// =============================================================================

interface PanelProps {
  panel: StreamgraphPanel;
  height?: number;
}

function StreamgraphPanel({ panel, height: propHeight }: PanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_DIMENSIONS.width);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const colorMap = useMemo(() => buildColorMap(panel.streams), [panel.streams]);
  const streamByKey = useMemo(() => {
    const map = new Map<string, StreamgraphStream>();
    for (const s of panel.streams) map.set(s.key, s);
    return map;
  }, [panel.streams]);

  useResizeObserver(containerRef, setWidth);

  const dims = useMemo(
    () => ({ ...DEFAULT_DIMENSIONS, width, height: propHeight ?? DEFAULT_DIMENSIONS.height }),
    [width, propHeight]
  );

  useRenderEffect(svgRef, panel, dims, colorMap);

  const handleMouseMove = useStreamHover(svgRef, streamByKey, setTooltip);
  const handleMouseLeave = useStreamLeave(svgRef, setTooltip);

  return (
    <div ref={containerRef} className="relative w-full">
      <PanelLabel instanceId={panel.instanceId} modelId={panel.modelId} />
      <svg
        ref={svgRef}
        className="w-full block"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {tooltip && <StreamTooltip tooltip={tooltip} />}
    </div>
  );
}

// =============================================================================
// Hooks
// =============================================================================

function useResizeObserver(
  ref: React.RefObject<HTMLDivElement | null>,
  setWidth: (w: number) => void
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const update = (): void => setWidth(Math.max(el.clientWidth, MIN_WIDTH));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, setWidth]);
}

function useRenderEffect(
  svgRef: React.RefObject<SVGSVGElement | null>,
  panel: StreamgraphPanel,
  dims: typeof DEFAULT_DIMENSIONS,
  colorMap: Map<string, string>
): void {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || panel.rows.length === 0) return;

    const sel = d3.select(svg);
    sel.attr('width', dims.width).attr('height', dims.height);

    let g = sel.select<SVGGElement>('g.chart-area');
    if (g.empty()) g = sel.append('g').attr('class', 'chart-area');
    g.attr('transform', `translate(${dims.margin.left}, ${dims.margin.top})`);

    const keys = panel.streams.map((s) => s.key);
    const layout = computeLayout({ rows: panel.rows, capacityRows: panel.capacityRows, keys, dims });

    renderCapacityPaths(g, layout, colorMap);
    renderPaths(g, layout, colorMap);
    renderAxis(sel, layout.xScale, dims);
    applyTransitions(g);
  }, [svgRef, panel, dims, colorMap]);
}

function useStreamHover(
  svgRef: React.RefObject<SVGSVGElement | null>,
  streamByKey: Map<string, StreamgraphStream>,
  setTooltip: (t: TooltipState | null) => void
): (event: React.MouseEvent<SVGSVGElement>) => void {
  return useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;

      const target = event.target as SVGElement;
      const path = target.closest('path.stream');
      if (!path) {
        setTooltip(null);
        highlightStream(d3.select(svg).select('g.chart-area'), null);
        return;
      }

      const datum = d3.select(path).datum() as { key: string } | undefined;
      if (!datum) return;

      const stream = streamByKey.get(datum.key);
      if (!stream) return;

      const rect = svg.getBoundingClientRect();
      setTooltip({ stream, x: event.clientX - rect.left, y: event.clientY - rect.top });
      highlightStream(d3.select(svg).select('g.chart-area'), datum.key);
    },
    [svgRef, streamByKey, setTooltip]
  );
}

function useStreamLeave(
  svgRef: React.RefObject<SVGSVGElement | null>,
  setTooltip: (t: TooltipState | null) => void
): () => void {
  return useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    setTooltip(null);
    highlightStream(d3.select(svg).select('g.chart-area'), null);
  }, [svgRef, setTooltip]);
}

// =============================================================================
// Panel label
// =============================================================================

function PanelLabel({ instanceId, modelId }: { instanceId: string; modelId: string }) {
  return (
    <div
      className="px-3 py-1 text-xs"
      style={{ color: '#888', fontFamily: "'JetBrains Mono', monospace" }}
    >
      <span style={{ color: '#aaa', fontWeight: 600 }}>{instanceId}</span>
      <span style={{ color: '#555' }}> / </span>
      <span>{modelId}</span>
    </div>
  );
}

// =============================================================================
// Tooltip
// =============================================================================

const TOOLTIP_OFFSET_X = 12;
const TOOLTIP_OFFSET_Y = -10;

function StreamTooltip({ tooltip }: { tooltip: TooltipState }) {
  const { stream, x, y } = tooltip;
  return (
    <div
      className="absolute pointer-events-none z-20 rounded px-2 py-1 text-xs"
      style={{
        left: x + TOOLTIP_OFFSET_X,
        top: y + TOOLTIP_OFFSET_Y,
        background: 'rgba(0,0,0,0.85)',
        color: '#eee',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: stream.color, fontWeight: 600 }}>{stream.jobType}</span>
    </div>
  );
}

// =============================================================================
// Legend
// =============================================================================

function StreamLegend({ streams }: { streams: StreamgraphStream[] }) {
  const uniqueJobTypes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of streams) {
      if (!seen.has(s.jobType)) seen.set(s.jobType, s.color);
    }
    return [...seen.entries()];
  }, [streams]);

  return (
    <div className="flex justify-center gap-4 py-2 text-xs text-muted-foreground">
      {uniqueJobTypes.map(([jt, color]) => (
        <div key={jt} className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
          <span>{jt}</span>
        </div>
      ))}
    </div>
  );
}
