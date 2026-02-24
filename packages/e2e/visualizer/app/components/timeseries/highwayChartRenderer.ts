/**
 * Pure canvas rendering functions for highway charts.
 * No React dependencies — only draws on a CanvasRenderingContext2D.
 */
import type { HighwayConfig, HighwayValues } from '@/lib/timeseries/highwayTypes';

import {
  type LaneLayout,
  VEHICLE_PADDING,
  computeLaneLayout,
  getLaneBackground,
  getVehicleColor,
} from './highwayChartHelpers';

/** Minimum bar width to apply vehicle padding */
const MIN_BAR_WIDTH_FOR_PADDING = 4;

/** Compute bar width from canvas width and data length */
function computeBarWidth(width: number, dataLength: number): number {
  return Math.floor(width / dataLength) - 1;
}

/** Compute effective padding based on bar dimensions */
function effectivePadding(w: number, h: number): number {
  if (w < MIN_BAR_WIDTH_FOR_PADDING || h < MIN_BAR_WIDTH_FOR_PADDING) return 0;
  return VEHICLE_PADDING;
}

/** Draw a single vehicle rectangle */
function drawVehicle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  const pad = effectivePadding(w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
}

/** Render vehicles within a lane using a uniform vehicle height */
function renderVehicles(
  ctx: CanvasRenderingContext2D,
  barX: number,
  barWidth: number,
  yOffset: number,
  laneHeight: number,
  running: number,
  vehicleHeight: number,
  vehicleColor: string
): void {
  if (running <= 0) return;

  for (let v = 0; v < running; v += 1) {
    const vehicleY = yOffset + laneHeight - (v + 1) * vehicleHeight;
    drawVehicle(ctx, barX, vehicleY, barWidth, vehicleHeight, vehicleColor);
  }
}

/** Render a single lane background */
function renderLaneBackground(
  ctx: CanvasRenderingContext2D,
  barX: number,
  barWidth: number,
  yOffset: number,
  laneHeight: number,
  bgColor: string
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(barX, yOffset, barWidth, laneHeight);
}

/** Render all lanes for a single time interval */
function renderIntervalLanes(
  ctx: CanvasRenderingContext2D,
  barX: number,
  barWidth: number,
  layouts: LaneLayout[],
  values: HighwayValues,
  intervalIndex: number,
  highway: HighwayConfig,
  vehicleHeight: number
): void {
  for (const layout of layouts) {
    const lane = highway.lanes[layout.laneIndex];
    const running = values.lanes[layout.laneIndex].running[intervalIndex];
    const bgColor = getLaneBackground(lane.color);
    const vehicleColor = getVehicleColor(lane.color);

    renderLaneBackground(ctx, barX, barWidth, layout.yOffset, layout.laneHeight, bgColor);
    renderVehicles(
      ctx,
      barX,
      barWidth,
      layout.yOffset,
      layout.laneHeight,
      running,
      vehicleHeight,
      vehicleColor
    );
  }
}

/** Collect slot values for all lanes at a given interval */
function collectLaneSlots(values: HighwayValues, intervalIndex: number): number[] {
  return values.lanes.map((lane) => lane.slots[intervalIndex]);
}

/** Main rendering entry point for a highway chart */
export function renderHighway(
  ctx: CanvasRenderingContext2D,
  values: HighwayValues,
  highway: HighwayConfig,
  width: number,
  height: number,
  dataLength: number
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  if (dataLength === 0) return;

  const barWidth = computeBarWidth(width, dataLength);

  for (let i = 0; i < dataLength; i += 1) {
    const modelSlots = values.modelSlots[i];
    if (modelSlots <= 0) continue;

    const vehicleHeight = height / modelSlots;
    const barX = i * (barWidth + 1);
    const laneSlots = collectLaneSlots(values, i);
    const layouts = computeLaneLayout(modelSlots, laneSlots, height);
    renderIntervalLanes(ctx, barX, barWidth, layouts, values, i, highway, vehicleHeight);
  }
}
