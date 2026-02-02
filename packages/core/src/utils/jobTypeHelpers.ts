/**
 * Helper functions for job type management.
 */
import {
  DEFAULT_RATIO_ADJUSTMENT_CONFIG,
  type JobTypeLoadMetrics,
  type JobTypeState,
  type RatioAdjustmentConfig,
  type ResourcesPerJob,
} from '../jobTypeTypes.js';

const ZERO = 0;
const ONE = 1;

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
});

/** Create initial states from config and calculated ratios */
export const createInitialStates = (
  resourcesPerJob: ResourcesPerJob,
  ratios: Map<string, number>
): Map<string, JobTypeState> => {
  const states = new Map<string, JobTypeState>();

  for (const [jobTypeId, jobConfig] of Object.entries(resourcesPerJob)) {
    const ratio = ratios.get(jobTypeId) ?? ZERO;
    const flexible = jobConfig.ratio?.flexible !== false;

    states.set(jobTypeId, {
      currentRatio: ratio,
      initialRatio: ratio,
      flexible,
      inFlight: ZERO,
      allocatedSlots: ZERO,
      resources: {
        estimatedNumberOfRequests: jobConfig.estimatedNumberOfRequests,
        estimatedUsedTokens: jobConfig.estimatedUsedTokens,
        estimatedUsedMemoryKB: jobConfig.estimatedUsedMemoryKB,
      },
    });
  }

  return states;
};

/** Collect load metrics from all job types */
export const collectLoadMetrics = (states: Map<string, JobTypeState>): JobTypeLoadMetrics[] => {
  const metrics: JobTypeLoadMetrics[] = [];

  for (const [jobTypeId, state] of states) {
    const loadPercentage = state.allocatedSlots > ZERO ? state.inFlight / state.allocatedSlots : ZERO;

    metrics.push({
      jobTypeId,
      loadPercentage,
      flexible: state.flexible,
      currentRatio: state.currentRatio,
    });
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

/** Recalculate allocated slots based on current ratios */
export const recalculateAllocatedSlots = (states: Map<string, JobTypeState>, totalCapacity: number): void => {
  for (const state of states.values()) {
    state.allocatedSlots = Math.floor(totalCapacity * state.currentRatio);
  }
};
