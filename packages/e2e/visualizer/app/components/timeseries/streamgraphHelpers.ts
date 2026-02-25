/**
 * D3 rendering helpers for the streamgraph chart.
 */
import type { StreamgraphRow, StreamgraphStream } from '@/lib/timeseries/streamgraphTransform';
import type { Series } from 'd3';
import * as d3 from 'd3';

// =============================================================================
// Types
// =============================================================================

type StackedSeries = Series<StreamgraphRow, string>[];

export interface StreamgraphLayout {
  stacked: StackedSeries;
  capacityStacked: StackedSeries;
  xScale: d3.ScaleLinear<number, number>;
  yScale: d3.ScaleLinear<number, number>;
  areaGen: d3.Area<[number, number]>;
  capacityAreaGen: d3.Area<[number, number]>;
}

export interface StreamgraphDimensions {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

// =============================================================================
// Constants
// =============================================================================

const AXIS_TICKS = 10;
const DIM_OPACITY = 0.15;
const FULL_OPACITY = 0.85;
const CAPACITY_OPACITY = 0.25;
const TRANSITION_MS = 200;

export const DEFAULT_DIMENSIONS: StreamgraphDimensions = {
  width: 800,
  height: 300,
  margin: { top: 10, right: 10, bottom: 30, left: 10 },
};

// =============================================================================
// Layout computation
// =============================================================================

interface ComputeLayoutParams {
  rows: StreamgraphRow[];
  capacityRows: StreamgraphRow[];
  keys: string[];
  dims: StreamgraphDimensions;
}

/** Compute D3 stacks for both running and capacity, sharing the same y-scale */
export function computeLayout(params: ComputeLayoutParams): StreamgraphLayout {
  const { rows, capacityRows, keys, dims } = params;
  const { width, height, margin } = dims;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const stackGen = d3.stack<StreamgraphRow>().keys(keys).offset(d3.stackOffsetNone).order(d3.stackOrderNone);
  const stacked = stackGen(rows);
  const capacityStacked = stackGen(capacityRows);

  const timeExtent = d3.extent(rows, (r) => r.time) as [number, number];
  const xScale = d3.scaleLinear().domain(timeExtent).range([0, innerW]);

  const yMax = d3.max(capacityStacked, (s) => d3.max(s, (d) => d[1])) ?? 1;
  const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

  const areaGen = buildAreaGen(xScale, yScale, rows);
  const capacityAreaGen = buildAreaGen(xScale, yScale, capacityRows);

  return { stacked, capacityStacked, xScale, yScale, areaGen, capacityAreaGen };
}

/** Create an area generator bound to a specific row set for x-indexing */
function buildAreaGen(
  xScale: d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  rows: StreamgraphRow[]
): d3.Area<[number, number]> {
  return d3
    .area<[number, number]>()
    .x((_d, i) => xScale(rows[i].time))
    .y0((d) => yScale(d[0]))
    .y1((d) => yScale(d[1]))
    .curve(d3.curveBasis);
}

// =============================================================================
// SVG rendering
// =============================================================================

/** Build a color lookup from streams */
export function buildColorMap(streams: StreamgraphStream[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of streams) {
    map.set(s.key, s.color);
  }
  return map;
}

/** Render capacity paths (lighter background layer) */
export function renderCapacityPaths(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  layout: StreamgraphLayout,
  colorMap: Map<string, string>
): void {
  g.selectAll('path.capacity')
    .data(layout.capacityStacked)
    .join('path')
    .attr('class', 'capacity')
    .attr('d', (d) => layout.capacityAreaGen(d as unknown as [number, number][]))
    .attr('fill', (d) => colorMap.get(d.key) ?? '#888')
    .attr('opacity', CAPACITY_OPACITY)
    .attr('stroke', 'none');
}

/** Render running paths (solid foreground layer) */
export function renderPaths(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  layout: StreamgraphLayout,
  colorMap: Map<string, string>
): void {
  g.selectAll('path.stream')
    .data(layout.stacked)
    .join('path')
    .attr('class', 'stream')
    .attr('d', (d) => layout.areaGen(d as unknown as [number, number][]))
    .attr('fill', (d) => colorMap.get(d.key) ?? '#888')
    .attr('opacity', FULL_OPACITY)
    .attr('stroke', 'none');
}

/** Render the x-axis */
export function renderAxis(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  xScale: d3.ScaleLinear<number, number>,
  dims: StreamgraphDimensions
): void {
  const { margin, height } = dims;
  const axisGroup = svg.selectAll<SVGGElement, unknown>('g.x-axis').data([null]);

  axisGroup
    .enter()
    .append('g')
    .attr('class', 'x-axis')
    .merge(axisGroup)
    .attr('transform', `translate(${margin.left}, ${height - margin.bottom})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(AXIS_TICKS)
        .tickFormat((d) => `${d}s`)
    );
}

// =============================================================================
// Hover interactions
// =============================================================================

/** Apply hover highlight — dim all except the hovered stream */
export function highlightStream(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  hoveredKey: string | null
): void {
  g.selectAll<SVGPathElement, Series<StreamgraphRow, string>>('path.stream').attr('opacity', (d) => {
    if (hoveredKey === null) return FULL_OPACITY;
    return d.key === hoveredKey ? 1 : DIM_OPACITY;
  });
  g.selectAll<SVGPathElement, Series<StreamgraphRow, string>>('path.capacity').attr('opacity', (d) => {
    if (hoveredKey === null) return CAPACITY_OPACITY;
    return d.key === hoveredKey ? CAPACITY_OPACITY : DIM_OPACITY;
  });
}

/** Add hover transitions */
export function applyTransitions(g: d3.Selection<SVGGElement, unknown, null, undefined>): void {
  g.selectAll('path.stream, path.capacity').style('transition', `opacity ${TRANSITION_MS}ms ease`);
}
