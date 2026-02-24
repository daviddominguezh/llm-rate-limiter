/**
 * Transform InstanceConfig[] into HighwayInstanceConfig[] by grouping metrics by model.
 * Also provides value extraction for efficient canvas rendering.
 */
import type { CapacityDataPoint, CapacityMetric, InstanceConfig } from './capacityTypes';
import type { HighwayConfig, HighwayInstanceConfig, HighwayLane, HighwayValues } from './highwayTypes';
import { extractNumericValues } from './highwayTypes';

const LABEL_SEPARATOR = ' / ';

const LANE_PALETTE = ['#E85E3B', '#3B8EE8', '#5EBB6E', '#D4A843', '#9B59B6', '#E67E22', '#1ABC9C', '#E74C3C'];

/** Extract model key from metric label like "model_alpha / critical" */
function extractModelKey(label: string): string {
  const idx = label.indexOf(LABEL_SEPARATOR);
  return idx >= 0 ? label.slice(0, idx) : label;
}

/** Extract job type from metric label like "model_alpha / critical" */
function extractJobType(label: string): string {
  const idx = label.indexOf(LABEL_SEPARATOR);
  return idx >= 0 ? label.slice(idx + LABEL_SEPARATOR.length) : label;
}

/** Collect all unique job types across all instances for deterministic color assignment */
function collectJobTypes(instances: InstanceConfig[]): string[] {
  const jobTypes = new Set<string>();
  for (const inst of instances) {
    for (const metric of inst.models) {
      jobTypes.add(extractJobType(metric.label));
    }
  }
  return [...jobTypes].sort();
}

/** Assign a color to each job type deterministically */
function assignLaneColors(jobTypes: string[]): Record<string, string> {
  const colors: Record<string, string> = {};
  jobTypes.forEach((jt, i) => {
    colors[jt] = LANE_PALETTE[i % LANE_PALETTE.length];
  });
  return colors;
}

/** Convert a CapacityMetric into a HighwayLane */
function metricToLane(metric: CapacityMetric, color: string): HighwayLane {
  return {
    jobType: extractJobType(metric.label),
    slotsKey: metric.slotsKey ?? metric.key + '_slots',
    runningKey: metric.usageKey,
    queuedKey: metric.queuedKey,
    color,
  };
}

/** Group an instance's metrics by model into HighwayConfig[] */
function groupByModel(metrics: CapacityMetric[], laneColors: Record<string, string>): HighwayConfig[] {
  const modelMap = new Map<string, HighwayConfig>();

  for (const metric of metrics) {
    const modelKey = extractModelKey(metric.label);
    let highway = modelMap.get(modelKey);
    if (!highway) {
      highway = {
        modelKey,
        modelLabel: modelKey,
        modelSlotsKey: metric.modelSlotsKey ?? '',
        lanes: [],
      };
      modelMap.set(modelKey, highway);
    }
    const color = laneColors[extractJobType(metric.label)] ?? '#888';
    highway.lanes.push(metricToLane(metric, color));
  }

  return [...modelMap.values()];
}

/** Build highway configs from instance configs */
export function buildHighwayConfigs(instances: InstanceConfig[]): HighwayInstanceConfig[] {
  const allJobTypes = collectJobTypes(instances);
  const laneColors = assignLaneColors(allJobTypes);

  return instances.map((inst) => ({
    instanceId: inst.instanceId,
    fullId: inst.fullId,
    highways: groupByModel(inst.models, laneColors),
  }));
}

/** Extract pre-computed numeric arrays for a highway */
export function extractHighwayValues(data: CapacityDataPoint[], highway: HighwayConfig): HighwayValues {
  return {
    modelSlots: extractNumericValues(data, highway.modelSlotsKey),
    lanes: highway.lanes.map((lane) => ({
      slots: extractNumericValues(data, lane.slotsKey),
      running: extractNumericValues(data, lane.runningKey),
      queued: extractNumericValues(data, lane.queuedKey),
    })),
  };
}
