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
  renderCapacityLine,
  renderCursorLine,
  renderRunning,
  renderStartLine,
} from './streamgraphHelpers';
import type { StreamgraphDimensions, StreamgraphLayout } from './streamgraphHelpers';
import { ModelGroup } from './StreamgraphModelGroup';
import type { CursorTooltipState } from './StreamgraphTooltip';
import { CursorTooltip } from './StreamgraphTooltip';
import type { AxisPosition, GroupCursorState, PanelProps } from './streamgraphTypes';

// =============================================================================
// Types
// =============================================================================

interface StreamgraphChartProps {
  data: StructuredCapacityResult;
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
  const { sortedPanels, groups } = useMemo(() => {
    const built = buildStreamgraphPanels(data);
    const grouped = groupPanelsByModel(built);
    grouped.sort((a, b) => groupEarliestTime(a) - groupEarliestTime(b));
    const flat = grouped.flat();
    return { sortedPanels: flat, groups: grouped };
  }, [data]);
  const axisPositions = useMemo(() => computeAxisPositions(sortedPanels), [sortedPanels]);

  if (sortedPanels.length === 0) {
    return <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>;
  }

  const legend = sortedPanels[0].streams;

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <ModelGroup
          key={group[0].modelId}
          group={group}
          propHeight={propHeight}
          axisPositions={axisPositions}
          startIdx={sortedPanels.indexOf(group[0])}
          PanelComponent={StreamgraphPanelView}
        />
      ))}
      <StreamLegend streams={legend} />
    </div>
  );
}

// =============================================================================
// Single panel — one SVG for one (instance, model)
// =============================================================================

function StreamgraphPanelView({ panel, height: propHeight, axisPosition, groupCursor, onCursorChange, groupYMax }: PanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_DIMENSIONS.width);
  const [tooltip, setTooltip] = useState<CursorTooltipState | null>(null);

  const colorMap = useMemo(() => buildColorMap(panel.streams), [panel.streams]);

  useResizeObserver(containerRef, setWidth);

  const dims = useMemo(() => {
    const topMargin = axisPosition === 'top' ? 30 : 0;
    const bottomMargin = axisPosition === 'bottom' ? 30 : 0;
    const margin = { ...DEFAULT_DIMENSIONS.margin, top: topMargin, bottom: bottomMargin };
    return { ...DEFAULT_DIMENSIONS, width, height: propHeight ?? DEFAULT_DIMENSIONS.height, margin };
  }, [width, propHeight, axisPosition]);

  const layout = useLayout(panel, dims, groupYMax);
  useRenderEffect({ svgRef, layout, dims, colorMap, axisPosition, panel });
  useCursorSync({ svgRef, layout, dims, groupCursor, panel });

  const handleMouseMove = useCursorHover({ svgRef, panel, layout, dims, setTooltip, onCursorChange });
  const handleMouseLeave = useCallback(() => setTooltip(null), []);

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

function useLayout(panel: StreamgraphPanel, dims: StreamgraphDimensions, groupYMax: number): StreamgraphLayout | null {
  return useMemo(() => {
    if (panel.runningRows.length === 0) return null;
    const keys = panel.streams.map((s) => s.key);
    return computeLayout({ runningRows: panel.runningRows, capacityRows: panel.capacityRows, keys, dims, groupYMax });
  }, [panel, dims, groupYMax]);
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

interface RenderEffectParams {
  svgRef: React.RefObject<SVGSVGElement | null>;
  layout: StreamgraphLayout | null;
  dims: StreamgraphDimensions;
  colorMap: Map<string, string>;
  axisPosition: AxisPosition;
  panel: StreamgraphPanel;
}

function useRenderEffect(params: RenderEffectParams): void {
  const { svgRef, layout, dims, colorMap, axisPosition, panel } = params;

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
    const times = panel.capacityRows.map((r) => r.time);
    renderCapacityLine(g, layout, panel.poolPerRow, times);
    const innerH = dims.height - dims.margin.top - dims.margin.bottom;
    renderStartLine(g, layout, panel.poolPerRow, times, innerH);
    sel.selectAll('g.x-axis').remove();
    if (axisPosition !== 'none') {
      renderAxis(sel, layout.xScale, dims, axisPosition);
    }
    applyTransitions(g);
  }, [svgRef, layout, dims, colorMap, axisPosition, panel]);
}

// =============================================================================
// Cursor sync — renders cursor line + highlight from shared group state
// =============================================================================

interface CursorSyncParams {
  svgRef: React.RefObject<SVGSVGElement | null>;
  layout: StreamgraphLayout | null;
  dims: StreamgraphDimensions;
  groupCursor: GroupCursorState | null;
  panel: StreamgraphPanel;
}

function useCursorSync(params: CursorSyncParams): void {
  const { svgRef, layout, dims, groupCursor, panel } = params;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const g = d3.select(svg).select<SVGGElement>('g.chart-area');

    if (groupCursor === null) {
      hideCursorLine(g);
      highlightStream(g, null);
      return;
    }

    const innerH = dims.height - dims.margin.top - dims.margin.bottom;
    const xPos = layout.xScale(panel.capacityRows[groupCursor.index].time);
    renderCursorLine(g, xPos, innerH);
    highlightStream(g, groupCursor.hoveredKey);
  }, [svgRef, layout, dims, groupCursor, panel]);
}

// =============================================================================
// Cursor hover — computes index and reports to group
// =============================================================================

interface CursorHoverParams {
  svgRef: React.RefObject<SVGSVGElement | null>;
  panel: StreamgraphPanel;
  layout: StreamgraphLayout | null;
  dims: StreamgraphDimensions;
  setTooltip: (t: CursorTooltipState | null) => void;
  onCursorChange: (c: GroupCursorState | null) => void;
}

function useCursorHover(params: CursorHoverParams): (e: React.MouseEvent<SVGSVGElement>) => void {
  const { svgRef, panel, layout, dims, setTooltip, onCursorChange } = params;

  return useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || !layout) return;

      const rect = svg.getBoundingClientRect();
      const chartX = event.clientX - rect.left - dims.margin.left;
      const index = findNearestIndex(panel.capacityRows, layout.xScale, chartX);
      const hoveredKey = detectHoveredKey(event);

      onCursorChange({ index, hoveredKey });

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
    [svgRef, panel, layout, dims, setTooltip, onCursorChange]
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

// =============================================================================
// Axis position helpers
// =============================================================================

/** Find the earliest time a panel has data (first non-zero pool) */
function earliestDataTime(panel: StreamgraphPanel): number {
  const idx = panel.poolPerRow.findIndex((v) => v > 0);
  if (idx < 0) return Infinity;
  return panel.capacityRows[idx].time;
}

/** Earliest data time across all panels in a group */
function groupEarliestTime(group: StreamgraphPanel[]): number {
  return Math.min(...group.map(earliestDataTime));
}

/** Group panels by modelId */
function groupPanelsByModel(panels: StreamgraphPanel[]): StreamgraphPanel[][] {
  const map = new Map<string, StreamgraphPanel[]>();
  for (const panel of panels) {
    const existing = map.get(panel.modelId);
    if (existing !== undefined) {
      existing.push(panel);
    } else {
      map.set(panel.modelId, [panel]);
    }
  }
  return [...map.values()];
}

/** First panel in a model group gets 'top', last gets 'bottom', others 'none' */
function computeAxisPositions(panels: StreamgraphPanel[]): AxisPosition[] {
  const positions: AxisPosition[] = panels.map(() => 'none' as AxisPosition);
  for (let i = 0; i < panels.length; i += 1) {
    const isFirst = i === 0 || panels[i].modelId !== panels[i - 1].modelId;
    const isLast = i === panels.length - 1 || panels[i].modelId !== panels[i + 1].modelId;
    if (isFirst) positions[i] = 'top';
    if (isLast) positions[i] = 'bottom';
  }
  return positions;
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
