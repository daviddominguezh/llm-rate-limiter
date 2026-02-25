/**
 * Transform StructuredCapacityResult into per-(instance, model) streamgraph data.
 *
 * Each panel provides:
 *   - capacityRows: { time, [jt]: capacityHeight } — stacked to form band boundaries
 *   - runningRows:  { time, [jt]: runningHeight }  — filled within each band
 *   - tooltipData:  raw running/capacity counts per time point for tooltip display
 */
import type { CapacityInterval, StructuredCapacityResult } from './structuredTransform';

// =============================================================================
// Types
// =============================================================================

export interface StreamgraphRow {
  time: number;
  [key: string]: number;
}

export interface StreamgraphStream {
  key: string;
  jobType: string;
  color: string;
}

/** Raw metric values for tooltip display at one time point */
export interface PanelTooltipRow {
  time: number;
  values: Record<string, { running: number; capacity: number }>;
}

/** One streamgraph for a specific (instance, model) pair */
export interface StreamgraphPanel {
  instanceId: string;
  modelId: string;
  runningRows: StreamgraphRow[];
  capacityRows: StreamgraphRow[];
  tooltipData: PanelTooltipRow[];
  streams: StreamgraphStream[];
  /** Per-row pool size (total capacity for this instance's model at each interval) */
  poolPerRow: number[];
}

/** All panels derived from a StructuredCapacityResult */
export type StreamgraphPanels = StreamgraphPanel[];

// =============================================================================
// Color palette — one color per job type
// =============================================================================

const JOB_TYPE_COLORS: Record<string, string> = {
  brainstorm: '#E85E3B',
  summarize: '#3B8EE8',
  analyzePDF: '#5EBB6E',
};

const FALLBACK_PALETTE = ['#D4A843', '#9B59B6', '#E67E22', '#1ABC9C', '#E74C3C', '#2ECC71'];

function getJobTypeColor(jobType: string, index: number): string {
  return JOB_TYPE_COLORS[jobType] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

// =============================================================================
// Discovery
// =============================================================================

interface PanelKey {
  instanceId: string;
  modelId: string;
}

/** Discover all unique (instance, model) pairs and their job types */
function discoverPanels(
  result: StructuredCapacityResult
): Map<string, { panel: PanelKey; jobTypes: Set<string> }> {
  const panels = new Map<string, { panel: PanelKey; jobTypes: Set<string> }>();

  for (const interval of result.data) {
    for (const [instId, models] of Object.entries(interval.instances)) {
      for (const [modelId, jobTypes] of Object.entries(models)) {
        const key = `${instId}|${modelId}`;
        let entry = panels.get(key);
        if (!entry) {
          entry = { panel: { instanceId: instId, modelId }, jobTypes: new Set() };
          panels.set(key, entry);
        }
        for (const jt of Object.keys(jobTypes)) {
          entry.jobTypes.add(jt);
        }
      }
    }
  }

  return panels;
}

// =============================================================================
// Row building
// =============================================================================

type HeightField = 'capacityHeight' | 'runningHeight';

/** Build rows extracting a specific height field for each job type */
function buildRows(
  result: StructuredCapacityResult,
  instanceId: string,
  modelId: string,
  jobTypeKeys: string[],
  field: HeightField
): StreamgraphRow[] {
  return result.data.map((interval) => {
    const row: StreamgraphRow = { time: interval.time };
    for (const jt of jobTypeKeys) {
      row[jt] = 0;
    }
    const modelData = interval.instances[instanceId]?.[modelId];
    if (modelData !== undefined) {
      for (const [jt, metrics] of Object.entries(modelData)) {
        row[jt] = metrics[field];
      }
    }
    return row;
  });
}

/** Build raw metric rows for tooltip display */
function buildTooltipData(
  result: StructuredCapacityResult,
  instanceId: string,
  modelId: string
): PanelTooltipRow[] {
  return result.data.map((interval) => {
    const values: Record<string, { running: number; capacity: number }> = {};
    const modelData = interval.instances[instanceId]?.[modelId];
    if (modelData !== undefined) {
      for (const [jt, metrics] of Object.entries(modelData)) {
        values[jt] = { running: metrics.running, capacity: metrics.capacity };
      }
    }
    return { time: interval.time, values };
  });
}

// =============================================================================
// Pool per row — for the capacity line overlay
// =============================================================================

/** Count how many instances have a model active at one interval */
function countActiveForModel(interval: CapacityInterval, modelId: string): number {
  let count = 0;
  for (const models of Object.values(interval.instances)) {
    if (models[modelId] !== undefined) count += 1;
  }
  return count;
}

/** Compute per-row pool size; 0 when this instance is inactive */
function computePoolPerRow(result: StructuredCapacityResult, instanceId: string, modelId: string): number[] {
  const totalSlots = result.setup.models[modelId]?.totalSlots ?? 0;
  return result.data.map((interval) => {
    if (interval.instances[instanceId]?.[modelId] === undefined) return 0;
    const active = countActiveForModel(interval, modelId);
    return active > 0 ? Math.floor(totalSlots / active) : 0;
  });
}

// =============================================================================
// Capacity rescaling — adjust frozen-basePool values to actual pool
// =============================================================================

/** Find the first non-zero value in poolPerRow (the frozen pool for this instance) */
function findFrozenPool(pool: number[]): number {
  for (const v of pool) {
    if (v > 0) return v;
  }
  return 0;
}

/** Rescale capacity rows from frozen-basePool values to actual pool at each interval */
function rescaleCapacityToPool(rows: StreamgraphRow[], pool: number[], keys: string[]): StreamgraphRow[] {
  const frozenPool = findFrozenPool(pool);
  if (frozenPool <= 0) return rows;
  return rows.map((row, i) => {
    const target = pool[i];
    if (target <= 0 || target === frozenPool) return row;
    const scale = target / frozenPool;
    const out: StreamgraphRow = { time: row.time };
    for (const k of keys) out[k] = row[k] * scale;
    return out;
  });
}

// =============================================================================
// Public API
// =============================================================================

/** Build one streamgraph panel per (instance, model) pair */
export function buildStreamgraphPanels(result: StructuredCapacityResult): StreamgraphPanels {
  const discovered = discoverPanels(result);
  const panels: StreamgraphPanels = [];

  for (const { panel, jobTypes } of discovered.values()) {
    const sortedJts = [...jobTypes].sort();
    const streams: StreamgraphStream[] = sortedJts.map((jt, i) => ({
      key: jt,
      jobType: jt,
      color: getJobTypeColor(jt, i),
    }));

    const runningRows = buildRows(result, panel.instanceId, panel.modelId, sortedJts, 'runningHeight');
    const rawCapacity = buildRows(result, panel.instanceId, panel.modelId, sortedJts, 'capacityHeight');
    const poolPerRow = computePoolPerRow(result, panel.instanceId, panel.modelId);
    const capacityRows = rescaleCapacityToPool(rawCapacity, poolPerRow, sortedJts);

    panels.push({
      instanceId: panel.instanceId,
      modelId: panel.modelId,
      runningRows,
      capacityRows,
      tooltipData: buildTooltipData(result, panel.instanceId, panel.modelId),
      streams,
      poolPerRow,
    });
  }

  return panels;
}
