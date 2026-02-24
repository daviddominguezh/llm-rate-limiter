/**
 * Types for highway-style capacity visualization.
 * Models are highways, job types are lanes, running jobs are vehicles.
 */
import type { CapacityDataPoint } from './capacityTypes';

/** A single lane within a highway (one job type) */
export interface HighwayLane {
  /** Job type identifier */
  jobType: string;
  /** Data key for per-job-type slot allocation */
  slotsKey: string;
  /** Data key for running/in-flight jobs */
  runningKey: string;
  /** Data key for queued jobs */
  queuedKey: string;
  /** Lane fill color from palette */
  color: string;
}

/** A highway = one model on one instance */
export interface HighwayConfig {
  /** Sanitized model key (e.g., "model_alpha") */
  modelKey: string;
  /** Display label for the model */
  modelLabel: string;
  /** Data key for model-level total slots */
  modelSlotsKey: string;
  /** All job type lanes for this model */
  lanes: HighwayLane[];
}

/** Per-instance highway grouping */
export interface HighwayInstanceConfig {
  /** Short instance ID (e.g., "inst1") */
  instanceId: string;
  /** Full instance UUID */
  fullId: string;
  /** One highway per model */
  highways: HighwayConfig[];
}

/** Pre-extracted numeric arrays for one lane across all intervals */
export interface LaneValues {
  slots: number[];
  running: number[];
  queued: number[];
}

/** Pre-extracted values for an entire highway across all intervals */
export interface HighwayValues {
  modelSlots: number[];
  lanes: LaneValues[];
}

/** Extract numeric array from data points for a given key */
export function extractNumericValues(data: CapacityDataPoint[], key: string): number[] {
  return data.map((d) => {
    const v = d[key];
    return typeof v === 'number' ? v : 0;
  });
}
