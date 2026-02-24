/**
 * Layout computation and color helpers for highway chart rendering.
 */

/** Gap between lanes in pixels */
export const LANE_GAP = 1;

/** Padding around each vehicle in pixels */
export const VEHICLE_PADDING = 1;

/** Minimum lane height to be visible */
export const MIN_LANE_HEIGHT = 3;

/** Layout result for a single lane at a single interval */
export interface LaneLayout {
  laneIndex: number;
  yOffset: number;
  laneHeight: number;
}

/** Compute Y-offset and height for each lane at a given interval */
export function computeLaneLayout(
  modelSlots: number,
  laneSlotValues: number[],
  chartHeight: number
): LaneLayout[] {
  if (modelSlots <= 0) return [];

  const layouts: LaneLayout[] = [];
  let currentY = 0;

  for (let i = 0; i < laneSlotValues.length; i += 1) {
    const slots = laneSlotValues[i];
    if (slots <= 0) continue;

    const rawHeight = (slots / modelSlots) * chartHeight;
    const laneHeight = Math.max(MIN_LANE_HEIGHT, rawHeight) - LANE_GAP;
    layouts.push({ laneIndex: i, yOffset: currentY, laneHeight });
    currentY += laneHeight + LANE_GAP;
  }

  return layouts;
}

const HEX_BASE = 16;
const HEX_OFFSET_R = 1;
const HEX_OFFSET_G = 3;
const HEX_OFFSET_B = 5;
const HEX_SLICE_LEN = 2;

/** Parse hex color to RGB components */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(HEX_OFFSET_R, HEX_OFFSET_R + HEX_SLICE_LEN), HEX_BASE),
    g: parseInt(hex.slice(HEX_OFFSET_G, HEX_OFFSET_G + HEX_SLICE_LEN), HEX_BASE),
    b: parseInt(hex.slice(HEX_OFFSET_B, HEX_OFFSET_B + HEX_SLICE_LEN), HEX_BASE),
  };
}

const MAX_CHANNEL = 255;
const BG_OPACITY = 0.25;

/** Get muted lane background color (semi-transparent version) */
export function getLaneBackground(color: string): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${BG_OPACITY})`;
}

/** Get vehicle color (full opacity, slightly brightened) */
export function getVehicleColor(color: string): string {
  const { r, g, b } = hexToRgb(color);
  const BRIGHTEN = 1.15;
  const br = Math.min(MAX_CHANNEL, Math.round(r * BRIGHTEN));
  const bg = Math.min(MAX_CHANNEL, Math.round(g * BRIGHTEN));
  const bb = Math.min(MAX_CHANNEL, Math.round(b * BRIGHTEN));
  return `rgb(${br}, ${bg}, ${bb})`;
}
