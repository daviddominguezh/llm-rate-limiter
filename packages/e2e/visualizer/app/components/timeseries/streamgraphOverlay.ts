/**
 * Crosshair line and band label overlays for the streamgraph chart.
 */
import type { StreamgraphRow, StreamgraphStream } from '@/lib/timeseries/streamgraphTransform';
import * as d3 from 'd3';

import type { StreamgraphDimensions, StreamgraphLayout } from './streamgraphHelpers';

// =============================================================================
// Types
// =============================================================================

type GSelection = d3.Selection<SVGGElement, unknown, null, undefined>;

/** Tooltip value for a single job type at a time point */
export interface CrosshairValue {
  jobType: string;
  color: string;
  running: number;
  capacity: number;
}

// =============================================================================
// Constants
// =============================================================================

const MIN_LABEL_BAND_HEIGHT = 18;
const LABEL_FONT_SIZE = '10px';

// =============================================================================
// Crosshair line
// =============================================================================

/** Create the crosshair line element (hidden by default) */
export function renderCrosshairLine(g: GSelection, dims: StreamgraphDimensions): void {
  const innerH = dims.height - dims.margin.top - dims.margin.bottom;

  g.selectAll('line.crosshair')
    .data([null])
    .join('line')
    .attr('class', 'crosshair')
    .attr('stroke', '#555')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3')
    .attr('y1', 0)
    .attr('y2', innerH)
    .style('display', 'none')
    .attr('pointer-events', 'none');
}

/** Show/hide and position the crosshair line */
export function updateCrosshairPosition(g: GSelection, xPos: number | null): void {
  const line = g.select<SVGLineElement>('line.crosshair');
  if (xPos === null) {
    line.style('display', 'none');
  } else {
    line.style('display', null).attr('x1', xPos).attr('x2', xPos);
  }
}

// =============================================================================
// Nearest time lookup
// =============================================================================

/** Find the index of the nearest time point to a mouse x position */
export function findNearestTimeIndex(
  rows: StreamgraphRow[],
  xScale: d3.ScaleLinear<number, number>,
  mouseX: number
): number {
  const time = xScale.invert(mouseX);
  const bisect = d3.bisector<StreamgraphRow, number>((r) => r.time).center;
  return bisect(rows, time);
}

// =============================================================================
// Crosshair tooltip data
// =============================================================================

/** Build tooltip values for all job types at a given time index */
export function buildCrosshairValues(
  streams: StreamgraphStream[],
  runningRows: StreamgraphRow[],
  capacityRows: StreamgraphRow[],
  index: number
): CrosshairValue[] {
  return streams.map((s) => ({
    jobType: s.jobType,
    color: s.color,
    running: runningRows[index][s.key] as number,
    capacity: capacityRows[index][s.key] as number,
  }));
}

// =============================================================================
// Band labels
// =============================================================================

interface LabelDatum {
  key: string;
  jobType: string;
  x: number;
  y: number;
}

/** Render inline job type labels centered on each capacity band */
export function renderBandLabels(
  g: GSelection,
  layout: StreamgraphLayout,
  streams: StreamgraphStream[],
  capacityRows: StreamgraphRow[]
): void {
  if (capacityRows.length === 0) return;

  const midIdx = Math.floor(capacityRows.length / 2);
  const labelData = buildLabelData(layout, streams, capacityRows, midIdx);

  g.selectAll<SVGTextElement, LabelDatum>('text.band-label')
    .data(labelData, (d) => d.key)
    .join('text')
    .attr('class', 'band-label')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', '#777')
    .attr('font-size', LABEL_FONT_SIZE)
    .attr('font-family', "'JetBrains Mono', monospace")
    .attr('opacity', 0.5)
    .attr('pointer-events', 'none')
    .text((d) => d.jobType);
}

function buildLabelData(
  layout: StreamgraphLayout,
  streams: StreamgraphStream[],
  capacityRows: StreamgraphRow[],
  midIdx: number
): LabelDatum[] {
  return streams
    .map((stream, i) => {
      const band = layout.capacityStacked[i];
      const midPoint = band[midIdx];
      const yTop = layout.yScale(midPoint[1]);
      const yBottom = layout.yScale(midPoint[0]);
      const bandHeight = Math.abs(yBottom - yTop);

      if (bandHeight < MIN_LABEL_BAND_HEIGHT) return null;

      return {
        key: stream.key,
        jobType: stream.jobType,
        x: layout.xScale(capacityRows[midIdx].time),
        y: (yTop + yBottom) / 2,
      };
    })
    .filter((d): d is LabelDatum => d !== null);
}
