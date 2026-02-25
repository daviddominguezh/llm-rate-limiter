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
  findNearestIndex,
  hideCursorLine,
  highlightStream,
  renderAxis,
  renderBands,
  renderCursorLine,
  renderRunning,
} from './streamgraphHelpers';
import type { StreamgraphDimensions, StreamgraphLayout } from './streamgraphHelpers';
import type { CursorTooltipState } from './StreamgraphTooltip';
import { CursorTooltip } from './StreamgraphTooltip';

// =============================================================================
// Types
// =============================================================================

interface StreamgraphChartProps {
  data: StructuredCapacityResult;
  height?: number;
}

interface PanelProps {
  panel: StreamgraphPanel;
  height?: number;
}

// =============================================================================
// Constants
// =============================================================================

const MIN_WIDTH = 100;

// =============================================================================
// Main component — renders one panel per (instance, model)
// =============================================================================

export function StreamgraphChart({ data, height: propHeight }: StreamgraphChartProps) {
  const panels = useMemo(() => {
    const built = buildStreamgraphPanels(data);
    built.sort((a, b) => a.modelId.localeCompare(b.modelId));
    return built;
  }, [data]);

  if (panels.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>;
  }

  const legend = panels[0].streams;

  return (
    <div className="space-y-2">
      {panels.map((panel) => (
        <StreamgraphPanel key={`${panel.instanceId}|${panel.modelId}`} panel={panel} height={propHeight} />
      ))}
      <StreamLegend streams={legend} />
    </div>
  );
}

// =============================================================================
// Single panel — one SVG for one (instance, model)
// =============================================================================

function StreamgraphPanel({ panel, height: propHeight }: PanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_DIMENSIONS.width);
  const [tooltip, setTooltip] = useState<CursorTooltipState | null>(null);

  const colorMap = useMemo(() => buildColorMap(panel.streams), [panel.streams]);

  useResizeObserver(containerRef, setWidth);

  const dims = useMemo(
    () => ({ ...DEFAULT_DIMENSIONS, width, height: propHeight ?? DEFAULT_DIMENSIONS.height }),
    [width, propHeight]
  );

  const layout = useLayout(panel, dims);
  useRenderEffect(svgRef, layout, dims, colorMap);

  const handleMouseMove = useCursorHover({ svgRef, panel, layout, dims, setTooltip });
  const handleMouseLeave = useCursorLeave(svgRef, setTooltip);

  return (
    <div ref={containerRef} className="flex w-full">
      <PanelLabel instanceId={panel.instanceId} modelId={panel.modelId} />
      <div className="relative flex-1 min-w-0">
        <svg ref={svgRef} className="w-full block" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        {tooltip && <CursorTooltip state={tooltip} />}
      </div>
    </div>
  );
}

// =============================================================================
// Layout
// =============================================================================

function useLayout(panel: StreamgraphPanel, dims: StreamgraphDimensions): StreamgraphLayout | null {
  return useMemo(() => {
    if (panel.runningRows.length === 0) return null;
    const keys = panel.streams.map((s) => s.key);
    return computeLayout({ runningRows: panel.runningRows, capacityRows: panel.capacityRows, keys, dims });
  }, [panel, dims]);
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
  layout: StreamgraphLayout | null,
  dims: StreamgraphDimensions,
  colorMap: Map<string, string>
): void {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout) return;

    const sel = d3.select(svg);
    sel.attr('width', dims.width).attr('height', dims.height);

    let g = sel.select<SVGGElement>('g.chart-area');
    if (g.empty()) g = sel.append('g').attr('class', 'chart-area');
    g.attr('transform', `translate(${dims.margin.left}, ${dims.margin.top})`);

    renderBands(g, layout, colorMap);
    renderRunning(g, layout, colorMap);
    renderAxis(sel, layout.xScale, dims);
    applyTransitions(g);
  }, [svgRef, layout, dims, colorMap]);
}

// =============================================================================
// Cursor hover
// =============================================================================

interface CursorHoverParams {
  svgRef: React.RefObject<SVGSVGElement | null>;
  panel: StreamgraphPanel;
  layout: StreamgraphLayout | null;
  dims: StreamgraphDimensions;
  setTooltip: (t: CursorTooltipState | null) => void;
}

function useCursorHover(params: CursorHoverParams): (e: React.MouseEvent<SVGSVGElement>) => void {
  const { svgRef, panel, layout, dims, setTooltip } = params;

  return useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !layout) return;

      const g = d3.select(svg).select<SVGGElement>('g.chart-area');
      const rect = svg.getBoundingClientRect();
      const chartX = event.clientX - rect.left - dims.margin.left;
      const index = findNearestIndex(panel.capacityRows, layout.xScale, chartX);
      console.log(`[cursor] ${panel.instanceId}|${panel.modelId} interval=${index} t=${panel.capacityRows[index].time}s`);
      const innerH = dims.height - dims.margin.top - dims.margin.bottom;
      renderCursorLine(g, layout.xScale(panel.capacityRows[index].time), innerH);

      const hoveredKey = detectHoveredKey(event);
      highlightStream(g, hoveredKey);

      const tooltipRow = panel.tooltipData[index];
      setTooltip({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        time: tooltipRow.time,
        hoveredKey,
        entries: panel.streams.map((s) => ({
          jobType: s.jobType,
          color: s.color,
          running: tooltipRow.values[s.jobType]?.running ?? 0,
          capacity: tooltipRow.values[s.jobType]?.capacity ?? 0,
        })),
      });
    },
    [svgRef, panel, layout, dims, setTooltip]
  );
}

/** Detect which job type the cursor is over */
function detectHoveredKey(event: React.MouseEvent<SVGSVGElement>): string | null {
  const target = event.target as SVGElement;
  const path = target.closest('path.running') ?? target.closest('path.band');
  if (!path) return null;
  const datum = d3.select(path).datum() as { key: string } | undefined;
  return datum?.key ?? null;
}

function useCursorLeave(
  svgRef: React.RefObject<SVGSVGElement | null>,
  setTooltip: (t: CursorTooltipState | null) => void
): () => void {
  return useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const g = d3.select(svg).select<SVGGElement>('g.chart-area');
    setTooltip(null);
    highlightStream(g, null);
    hideCursorLine(g);
  }, [svgRef, setTooltip]);
}

// =============================================================================
// Panel label
// =============================================================================

function PanelLabel({ instanceId, modelId }: { instanceId: string; modelId: string }) {
  return (
    <div className="flex items-center justify-center shrink-0 pl-3" style={{ width: 40 }}>
      <div
        className="text-xs whitespace-nowrap"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: '#888',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <span style={{ color: '#aaa', fontWeight: 600 }}>{instanceId}</span>
        <span style={{ color: '#555' }}> / </span>
        <span>{modelId}</span>
      </div>
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
