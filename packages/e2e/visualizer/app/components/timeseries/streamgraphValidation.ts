/**
 * Debug validation: checks that for each model, the sum of capacity stack
 * heights across instances is consistent at every interval.
 */
import type { StreamgraphPanel, StreamgraphRow } from '@/lib/timeseries/streamgraphTransform';
import { useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

interface ModelIntervalTotal {
  intervalIdx: number;
  time: number;
  totalHeight: number;
  perInstance: Record<string, number>;
}

// =============================================================================
// Hook
// =============================================================================

/** Log validation of stack height consistency across instances per model */
export function useValidateStackHeights(panels: StreamgraphPanel[]): void {
  useEffect(() => {
    if (panels.length === 0) return;
    const byModel = groupByModel(panels);

    for (const [modelId, modelPanels] of Object.entries(byModel)) {
      validateModel(modelId, modelPanels);
    }
  }, [panels]);
}

// =============================================================================
// Helpers
// =============================================================================

function groupByModel(panels: StreamgraphPanel[]): Record<string, StreamgraphPanel[]> {
  const groups: Record<string, StreamgraphPanel[]> = {};
  for (const panel of panels) {
    const arr = groups[panel.modelId] ?? [];
    arr.push(panel);
    groups[panel.modelId] = arr;
  }
  return groups;
}

/** Sum all capacity values in one row (excluding the `time` key) */
function rowStackHeight(row: StreamgraphRow): number {
  let total = 0;
  for (const [key, val] of Object.entries(row)) {
    if (key !== 'time') total += val;
  }
  return total;
}

/** Check if all instances have non-zero contribution */
function allInstancesActive(perInstance: Record<string, number>): boolean {
  return Object.values(perInstance).every((v) => v > 0);
}

function validateModel(modelId: string, modelPanels: StreamgraphPanel[]): void {
  const intervalCount = modelPanels[0].capacityRows.length;
  const totals: ModelIntervalTotal[] = [];

  for (let i = 0; i < intervalCount; i += 1) {
    const perInstance: Record<string, number> = {};
    let totalHeight = 0;

    for (const panel of modelPanels) {
      const h = rowStackHeight(panel.capacityRows[i]);
      perInstance[panel.instanceId] = h;
      totalHeight += h;
    }

    totals.push({
      intervalIdx: i,
      time: modelPanels[0].capacityRows[i].time,
      totalHeight,
      perInstance,
    });
  }

  logModelSummary(modelId, totals);
}

function logModelSummary(modelId: string, totals: ModelIntervalTotal[]): void {
  const allActive = totals.filter((t) => allInstancesActive(t.perInstance));
  const partialActive = totals.filter((t) => !allInstancesActive(t.perInstance));

  logPhase(modelId, 'ALL ACTIVE', allActive);
  logPhase(modelId, 'PARTIAL (some inst=0)', partialActive);
}

function logPhase(modelId: string, phase: string, entries: ModelIntervalTotal[]): void {
  if (entries.length === 0) return;

  const heights = entries.map((t) => t.totalHeight);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const sampleSize = 5;

  console.log(
    `[Validation] ${modelId} — ${phase}: count=${entries.length}, min=${min.toFixed(2)}, max=${max.toFixed(2)}`
  );

  const uniqueHeights = [...new Set(heights.map((h) => h.toFixed(4)))];
  logUniqueHeights(uniqueHeights);

  const sample = pickSpreadSample(entries, sampleSize);
  for (const t of sample) {
    console.log(`  [${t.intervalIdx}] t=${t.time.toFixed(1)}s total=${t.totalHeight.toFixed(4)}`, t.perInstance);
  }
}

function logUniqueHeights(uniqueHeights: string[]): void {
  const maxDisplay = 10;
  if (uniqueHeights.length <= maxDisplay) {
    console.log(`  unique totals: [${uniqueHeights.join(', ')}]`);
  } else {
    console.log(`  ${uniqueHeights.length} distinct totals`);
  }
}

/** Pick entries spread evenly across the array */
function pickSpreadSample(entries: ModelIntervalTotal[], count: number): ModelIntervalTotal[] {
  if (entries.length <= count) return entries;
  const step = (entries.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => entries[Math.round(i * step)]);
}
