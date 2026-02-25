/**
 * Helper functions for job type management.
 */
import {
  DEFAULT_RATIO_ADJUSTMENT_CONFIG,
  type JobTypeLoadMetrics,
  type JobTypeResources,
  type JobTypeState,
  type RatioAdjustmentConfig,
  type ResourceEstimationsPerJob,
} from '../jobTypeTypes.js';
import type { QueuedWaiter } from './jobTypeManagerTypes.js';
import type { HasCapacityParams, ModelJobTypeTracker } from './jobTypeModelState.js';

const ZERO = 0;
const ONE = 1;
const PRECISION_DIGITS = 4;

/** Merge a single config value with default */
const withDefault = <K extends keyof RatioAdjustmentConfig>(
  config: RatioAdjustmentConfig | undefined,
  key: K
): Required<RatioAdjustmentConfig>[K] => config?.[key] ?? DEFAULT_RATIO_ADJUSTMENT_CONFIG[key];

/** Merge config with defaults */
export const mergeRatioConfig = (config?: RatioAdjustmentConfig): Required<RatioAdjustmentConfig> => ({
  highLoadThreshold: withDefault(config, 'highLoadThreshold'),
  lowLoadThreshold: withDefault(config, 'lowLoadThreshold'),
  maxAdjustment: withDefault(config, 'maxAdjustment'),
  minRatio: withDefault(config, 'minRatio'),
  adjustmentIntervalMs: withDefault(config, 'adjustmentIntervalMs'),
  releasesPerAdjustment: withDefault(config, 'releasesPerAdjustment'),
  minJobTypeCapacity: withDefault(config, 'minJobTypeCapacity'),
  idleDecayRate: withDefault(config, 'idleDecayRate'),
});

/** Create initial states from config and calculated ratios */
export const createInitialStates = (
  resourcesPerJob: ResourceEstimationsPerJob,
  ratios: Map<string, number>
): Map<string, JobTypeState> => {
  const states = new Map<string, JobTypeState>();

  for (const [jobTypeId, jobConfig] of Object.entries(resourcesPerJob)) {
    const ratio = ratios.get(jobTypeId) ?? ZERO;
    const flexible = jobConfig.ratio?.flexible !== false;

    const resources: JobTypeResources = {
      estimatedNumberOfRequests: jobConfig.estimatedNumberOfRequests,
      estimatedUsedTokens: jobConfig.estimatedUsedTokens,
      estimatedUsedMemoryKB: jobConfig.estimatedUsedMemoryKB,
    };

    states.set(jobTypeId, {
      currentRatio: ratio,
      initialRatio: ratio,
      flexible,
      inFlight: ZERO,
      allocatedSlots: ZERO,
      resources,
    });
  }

  return states;
};

/** Collect load metrics from all job types (includes queued demand in load) */
export const collectLoadMetrics = (
  states: Map<string, JobTypeState>,
  waitQueues: Map<string, QueuedWaiter[]>
): JobTypeLoadMetrics[] => {
  const metrics: JobTypeLoadMetrics[] = [];

  for (const [jobTypeId, state] of states) {
    const queueLength = waitQueues.get(jobTypeId)?.length ?? ZERO;
    const demand = state.inFlight + queueLength;
    const loadPercentage = state.allocatedSlots > ZERO ? demand / state.allocatedSlots : ZERO;

    metrics.push({
      jobTypeId,
      loadPercentage,
      flexible: state.flexible,
      currentRatio: state.currentRatio,
    });
  }

  return metrics;
};

/** Build HasCapacityParams for a model+jobType, returns undefined if job type unknown */
export const buildCapacityParams = (
  states: Map<string, JobTypeState>,
  minCapacity: number,
  modelId: string,
  jobTypeId: string
): HasCapacityParams | undefined => {
  const state = states.get(jobTypeId);
  if (state === undefined) return undefined;
  return { modelId, jobTypeId, ratio: state.currentRatio, resources: state.resources, minCapacity };
};

/** Parameters for collecting primary model load metrics */
export interface PrimaryModelLoadParams {
  states: Map<string, JobTypeState>;
  modelState: ModelJobTypeTracker;
  primaryModelId: string;
  minCapacity: number;
  waitQueues: Map<string, QueuedWaiter[]>;
}

/** Collect load metrics using only the primary model's per-jobType inFlight/allocated (includes queued demand) */
export const collectPrimaryModelLoadMetrics = (params: PrimaryModelLoadParams): JobTypeLoadMetrics[] => {
  const { states, modelState, primaryModelId, minCapacity, waitQueues } = params;
  const metrics: JobTypeLoadMetrics[] = [];

  for (const [jobTypeId, state] of states) {
    const capacityParams = buildCapacityParams(states, minCapacity, primaryModelId, jobTypeId);
    const allocated = capacityParams === undefined ? ZERO : modelState.getAllocated(capacityParams);
    const inFlight = modelState.getConcurrentInFlight(primaryModelId, jobTypeId);
    const queueLength = waitQueues.get(jobTypeId)?.length ?? ZERO;
    const demand = inFlight + queueLength;
    const loadPercentage = allocated > ZERO ? demand / allocated : ZERO;

    metrics.push({ jobTypeId, loadPercentage, flexible: state.flexible, currentRatio: state.currentRatio });
  }

  return metrics;
};

/** Identify donors (low load, flexible) */
export const identifyDonors = (
  metrics: JobTypeLoadMetrics[],
  lowThreshold: number,
  minRatio: number
): JobTypeLoadMetrics[] =>
  metrics.filter((m) => m.flexible && m.loadPercentage < lowThreshold && m.currentRatio > minRatio);

/** Identify receivers (high load, flexible) */
export const identifyReceivers = (
  metrics: JobTypeLoadMetrics[],
  highThreshold: number
): JobTypeLoadMetrics[] => metrics.filter((m) => m.flexible && m.loadPercentage > highThreshold);

/** Calculate donor contributions */
export const calculateDonorContributions = (
  donors: JobTypeLoadMetrics[],
  states: Map<string, JobTypeState>,
  config: Required<RatioAdjustmentConfig>
): Map<string, number> => {
  const contributions = new Map<string, number>();

  for (const donor of donors) {
    const state = states.get(donor.jobTypeId);
    if (state === undefined) continue;

    const excess = state.currentRatio - config.minRatio;
    const contribution = Math.min(excess, config.maxAdjustment) * (ONE - donor.loadPercentage);
    contributions.set(donor.jobTypeId, contribution);
  }

  return contributions;
};

/** Apply ratio transfers between donors and receivers */
export const applyRatioTransfers = (
  states: Map<string, JobTypeState>,
  donorContributions: Map<string, number>,
  receivers: JobTypeLoadMetrics[],
  availableToTransfer: number
): void => {
  const totalReceiverLoad = receivers.reduce((sum, r) => sum + r.loadPercentage, ZERO);
  if (totalReceiverLoad <= ZERO) return;

  // Reduce donor ratios
  for (const [donorId, contribution] of donorContributions) {
    const state = states.get(donorId);
    if (state !== undefined) {
      state.currentRatio -= contribution;
    }
  }

  // Increase receiver ratios
  for (const receiver of receivers) {
    const state = states.get(receiver.jobTypeId);
    if (state !== undefined) {
      const share = (receiver.loadPercentage / totalReceiverLoad) * availableToTransfer;
      state.currentRatio += share;
    }
  }
};

/** Normalize ratios to sum to 1 */
export const normalizeRatios = (states: Map<string, JobTypeState>): void => {
  let totalRatio = ZERO;
  for (const state of states.values()) {
    totalRatio += state.currentRatio;
  }

  if (totalRatio > ZERO) {
    for (const state of states.values()) {
      state.currentRatio /= totalRatio;
    }
  }
};

/** Log ratio adjustment details */
export const logRatioAdjustment = (
  log: (message: string, data?: Record<string, unknown>) => void,
  states: Map<string, JobTypeState>,
  donors: JobTypeLoadMetrics[],
  receivers: JobTypeLoadMetrics[]
): void => {
  log('Ratios adjusted', {
    ratios: Object.fromEntries(
      Array.from(states.entries()).map(([id, s]) => [id, s.currentRatio.toFixed(PRECISION_DIGITS)])
    ),
    donors: donors.map((d) => d.jobTypeId),
    receivers: receivers.map((r) => r.jobTypeId),
  });
};

/** Recalculate allocated slots based on current ratios, enforcing minCapacity per job type */
export const recalculateAllocatedSlots = (
  states: Map<string, JobTypeState>,
  totalCapacity: number,
  minCapacity: number = ONE
): void => {
  for (const state of states.values()) {
    state.allocatedSlots = Math.max(minCapacity, Math.floor(totalCapacity * state.currentRatio));
  }
};

/** Wake queued waiters for a single job type until capacity is full */
const drainJobTypeQueue = (
  states: Map<string, JobTypeState>,
  waitQueues: Map<string, QueuedWaiter[]>,
  jobTypeId: string
): void => {
  const state = states.get(jobTypeId);
  const queue = waitQueues.get(jobTypeId);
  if (state === undefined || queue === undefined) return;
  while (queue.length > ZERO && state.inFlight < state.allocatedSlots) {
    const waiter = queue.shift();
    if (waiter !== undefined) {
      state.inFlight += ONE;
      waiter.resolve();
    }
  }
};

/** Wake all queued waiters that can now be served after capacity changes */
export const drainWaitQueues = (
  states: Map<string, JobTypeState>,
  waitQueues: Map<string, QueuedWaiter[]>
): void => {
  for (const jobTypeId of states.keys()) {
    drainJobTypeQueue(states, waitQueues, jobTypeId);
  }
};

/** Decay flexible ratios toward their initial values when all job types are idle */
export const decayToInitialRatios = (states: Map<string, JobTypeState>, decayRate: number): boolean => {
  const minDistance = 0.001;
  let anyDecayed = false;

  for (const state of states.values()) {
    if (!state.flexible) continue;
    const distance = state.initialRatio - state.currentRatio;
    if (Math.abs(distance) < minDistance) continue;
    state.currentRatio += distance * decayRate;
    anyDecayed = true;
  }

  if (anyDecayed) {
    normalizeRatios(states);
  }
  return anyDecayed;
};

/** Apply memory constraints to allocated slots: finalSlots = min(distributed, memoryBased) */
export const applyMemoryConstraints = (
  states: Map<string, JobTypeState>,
  memoryCapacityKB: number | null,
  minCapacity: number
): void => {
  if (memoryCapacityKB === null) return;
  for (const state of states.values()) {
    const memKB = state.resources.estimatedUsedMemoryKB ?? ZERO;
    if (memKB > ZERO) {
      const memSlots = Math.floor((memoryCapacityKB * state.currentRatio) / memKB);
      state.allocatedSlots = Math.max(minCapacity, Math.min(state.allocatedSlots, memSlots));
    }
  }
};
