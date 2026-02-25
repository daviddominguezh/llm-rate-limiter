/**
 * Transform StructuredCapacityResult into per-(instance, model) streamgraph data.
 *
 * Each panel provides:
 *   - capacityRows: { time, [jt]: capacityHeight } — stacked to form band boundaries
 *   - runningRows:  { time, [jt]: runningHeight }  — filled within each band
 *   - tooltipData:  raw running/capacity counts per time point for tooltip display
 */
import type { StructuredCapacityResult } from './structuredTransform';

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
    const capacityRows = buildRows(result, panel.instanceId, panel.modelId, sortedJts, 'capacityHeight');
    const tooltipData = buildTooltipData(result, panel.instanceId, panel.modelId);

    panels.push({
      instanceId: panel.instanceId,
      modelId: panel.modelId,
      runningRows,
      capacityRows,
      tooltipData,
      streams,
    });
  }

  return panels;
}
