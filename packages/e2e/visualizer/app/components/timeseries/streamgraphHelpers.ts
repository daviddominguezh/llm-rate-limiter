/**
 * D3 rendering helpers for the streamgraph chart.
 *
 * Capacity values are stacked to form band boundaries.
 * Running values fill within each band from the bottom edge up.
 */
import type { StreamgraphRow, StreamgraphStream } from '@/lib/timeseries/streamgraphTransform';
import type { Series } from 'd3';
import * as d3 from 'd3';

// =============================================================================
// Types
// =============================================================================

type StackedSeries = Series<StreamgraphRow, string>[];

/** A layer of [y0, y1] pairs for rendering an area within a band */
interface RunningLayer {
  key: string;
  points: [number, number][];
}

export interface StreamgraphLayout {
  capacityStacked: StackedSeries;
  runningLayers: RunningLayer[];
  xScale: d3.ScaleLinear<number, number>;
  yScale: d3.ScaleLinear<number, number>;
  bandAreaGen: d3.Area<[number, number]>;
  runningAreaGen: d3.Area<[number, number]>;
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
const BAND_OPACITY = 0.2;
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
  runningRows: StreamgraphRow[];
  capacityRows: StreamgraphRow[];
  keys: string[];
  dims: StreamgraphDimensions;
}

/** Stack capacity for band boundaries, compute running fills within bands */
export function computeLayout(params: ComputeLayoutParams): StreamgraphLayout {
  const { runningRows, capacityRows, keys, dims } = params;
  const innerW = dims.width - dims.margin.left - dims.margin.right;
  const innerH = dims.height - dims.margin.top - dims.margin.bottom;

  const capacityStacked = d3
    .stack<StreamgraphRow>()
    .keys(keys)
    .offset(d3.stackOffsetNone)
    .order(d3.stackOrderNone)(capacityRows);

  const timeExtent = d3.extent(capacityRows, (r) => r.time) as [number, number];
  const xScale = d3.scaleLinear().domain(timeExtent).range([0, innerW]);

  const yMax = d3.max(capacityStacked, (s) => d3.max(s, (d) => d[1])) ?? 1;
  const yScale = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

  const runningLayers = buildRunningLayers(capacityStacked, runningRows, keys);
  const bandAreaGen = buildAreaGen(xScale, yScale, capacityRows);
  const runningAreaGen = buildAreaGen(xScale, yScale, runningRows);

  return { capacityStacked, runningLayers, xScale, yScale, bandAreaGen, runningAreaGen };
}

/** Build running layers: each point's y0 = band bottom, y1 = band bottom + running */
function buildRunningLayers(
  capacityStacked: StackedSeries,
  runningRows: StreamgraphRow[],
  keys: string[]
): RunningLayer[] {
  return capacityStacked.map((capSeries, idx) => {
    const key = keys[idx];
    const points: [number, number][] = capSeries.map((point, i) => {
      const bandBottom = point[0];
      const bandTop = point[1];
      const running = runningRows[i][key] as number;
      return [bandBottom, Math.min(bandBottom + running, bandTop)];
    });
    return { key, points };
  });
}

/** Create an area generator bound to a row set for x-indexing */
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

/** Render capacity band areas (lighter background) */
export function renderBands(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  layout: StreamgraphLayout,
  colorMap: Map<string, string>
): void {
  g.selectAll('path.band')
    .data(layout.capacityStacked)
    .join('path')
    .attr('class', 'band')
    .attr('d', (d) => layout.bandAreaGen(d as unknown as [number, number][]))
    .attr('fill', (d) => colorMap.get(d.key) ?? '#888')
    .attr('opacity', BAND_OPACITY)
    .attr('stroke', 'none');
}

/** Render running fill areas (solid foreground within bands) */
export function renderRunning(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  layout: StreamgraphLayout,
  colorMap: Map<string, string>
): void {
  g.selectAll('path.running')
    .data(layout.runningLayers)
    .join('path')
    .attr('class', 'running')
    .attr('d', (d) => layout.runningAreaGen(d.points))
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
// Cursor line
// =============================================================================

/** Render a vertical dashed cursor line at the given x position */
export function renderCursorLine(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  x: number,
  innerH: number
): void {
  let line = g.select<SVGLineElement>('line.cursor');
  if (line.empty()) {
    line = g.append('line').attr('class', 'cursor');
  }
  line
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', 0)
    .attr('y2', innerH)
    .attr('stroke', '#555')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,3');
}

/** Remove the cursor line */
export function hideCursorLine(g: d3.Selection<SVGGElement, unknown, null, undefined>): void {
  g.select('line.cursor').remove();
}

/** Find the index of the nearest time point to the mouse x position */
export function findNearestIndex(
  rows: StreamgraphRow[],
  xScale: d3.ScaleLinear<number, number>,
  mouseX: number
): number {
  const time = xScale.invert(mouseX);
  const bisect = d3.bisector<StreamgraphRow, number>((r) => r.time).center;
  return bisect(rows, time);
}

// =============================================================================
// Hover interactions
// =============================================================================

/** Apply hover highlight — dim all except the hovered job type */
export function highlightStream(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  hoveredKey: string | null
): void {
  highlightBands(g, hoveredKey);
  highlightRunning(g, hoveredKey);
}

function highlightBands(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  hoveredKey: string | null
): void {
  g.selectAll<SVGPathElement, Series<StreamgraphRow, string>>('path.band').attr('opacity', (d) => {
    if (hoveredKey === null) return BAND_OPACITY;
    return d.key === hoveredKey ? BAND_OPACITY : DIM_OPACITY;
  });
}

function highlightRunning(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  hoveredKey: string | null
): void {
  g.selectAll<SVGPathElement, RunningLayer>('path.running').attr('opacity', (d) => {
    if (hoveredKey === null) return FULL_OPACITY;
    return d.key === hoveredKey ? 1 : DIM_OPACITY;
  });
}

/** Add hover transitions */
export function applyTransitions(g: d3.Selection<SVGGElement, unknown, null, undefined>): void {
  g.selectAll('path.band, path.running').style('transition', `opacity ${TRANSITION_MS}ms ease`);
}
