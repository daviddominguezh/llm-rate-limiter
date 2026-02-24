/**
 * Gap analysis helpers: find time intervals where no jobs were running
 * for a given (jobType, model) combination.
 *
 * Uses snapshot inFlight data (rate limiter state) rather than job events,
 * matching what the visualizer highway chart shows.
 */
import type { JobRecord, StateSnapshot } from '@llm-rate-limiter/e2e-test-results';

const MS_TO_SECONDS = 1000;
const ZERO = 0;
const INCREMENT = 1;
const MIN_GAP_MS = 500;
const SEPARATOR = ' / ';
const DECIMAL_PLACES = 1;

/** A gap where no jobs were running */
export interface GapRecord {
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Analysis result for a single (jobType, model) group */
export interface GroupAnalysis {
  jobType: string;
  model: string;
  jobCount: number;
  gaps: GapRecord[];
  totalGapMs: number;
}

/** Parameters for gap detection */
export interface GapSearchParams {
  snapshots: StateSnapshot[];
  model: string;
  jobType: string;
  startTime: number;
  endTime: number;
}

/** Build a GapRecord from start/end timestamps */
const buildGap = (startMs: number, endMs: number): GapRecord => ({
  startMs,
  endMs,
  durationMs: endMs - startMs,
});

/** Sum inFlight across all instances for a (model, jobType) at a snapshot */
const sumInFlight = (snapshot: StateSnapshot, model: string, jobType: string): number => {
  let total = ZERO;
  for (const state of Object.values(snapshot.instances)) {
    const jtState = state.models[model]?.jobTypes?.[jobType];
    total += jtState?.inFlight ?? ZERO;
  }
  return total;
};

/** Process a snapshot and update gap tracking state */
const processSnapshot = (
  snapshot: StateSnapshot,
  params: GapSearchParams,
  gaps: GapRecord[],
  gapStart: number | null
): number | null => {
  const inFlight = sumInFlight(snapshot, params.model, params.jobType);

  if (inFlight > ZERO && gapStart !== null) {
    if (snapshot.timestamp > gapStart) {
      gaps.push(buildGap(gapStart, snapshot.timestamp));
    }
    return null;
  }
  if (inFlight === ZERO && gapStart === null) {
    return snapshot.timestamp;
  }
  return gapStart;
};

/** Find gaps from snapshot inFlight data for a (model, jobType) */
export const findGaps = (params: GapSearchParams): GapRecord[] => {
  const gaps: GapRecord[] = [];
  let gapStart: number | null = params.startTime;

  for (const snapshot of params.snapshots) {
    if (snapshot.timestamp < params.startTime || snapshot.timestamp > params.endTime) continue;
    gapStart = processSnapshot(snapshot, params, gaps, gapStart);
  }

  if (gapStart !== null && gapStart < params.endTime) {
    gaps.push(buildGap(gapStart, params.endTime));
  }

  return gaps.filter((g) => g.durationMs >= MIN_GAP_MS);
};

/** Collect groups from a single instance's model state */
const collectInstanceGroups = (
  models: Record<string, { jobTypes?: Record<string, unknown> }>,
  groups: Set<string>
): void => {
  for (const [modelId, modelState] of Object.entries(models)) {
    if (modelState.jobTypes === undefined) continue;
    for (const jobType of Object.keys(modelState.jobTypes)) {
      groups.add(`${jobType}${SEPARATOR}${modelId}`);
    }
  }
};

/** Discover all (jobType, model) groups from snapshot data */
export const discoverGroups = (snapshots: StateSnapshot[]): Set<string> => {
  const groups = new Set<string>();
  for (const snapshot of snapshots) {
    for (const state of Object.values(snapshot.instances)) {
      collectInstanceGroups(state.models, groups);
    }
  }
  return groups;
};

/** Get modelId from the started event (fallback for incomplete jobs) */
const getStartedModelId = (job: JobRecord): string | null => {
  const event = job.events.find((e) => e.type === 'started');
  return event?.modelId ?? null;
};

/** Count jobs per (jobType, model) group from job records */
export const countJobsByGroup = (jobs: Record<string, JobRecord>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const job of Object.values(jobs)) {
    const model = job.modelUsed ?? getStartedModelId(job);
    if (model === null) continue;
    const key = `${job.jobType}${SEPARATOR}${model}`;
    const prev = counts.get(key) ?? ZERO;
    counts.set(key, prev + INCREMENT);
  }
  return counts;
};

/** Parse group key back into jobType and model */
export const parseGroupKey = (key: string): { jobType: string; model: string } => {
  const parts = key.split(SEPARATOR);
  const [jobType = '', model = ''] = parts;
  return { jobType, model };
};

/** Format milliseconds as seconds string */
export const formatSeconds = (ms: number): string => (ms / MS_TO_SECONDS).toFixed(DECIMAL_PLACES);
