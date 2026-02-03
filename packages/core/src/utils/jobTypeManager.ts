/**
 * Job Type Manager - Manages job type state, capacity allocation, and dynamic ratio adjustment.
 */
import type {
  JobTypeLoadMetrics,
  JobTypeState,
  JobTypeStats,
  RatioAdjustmentConfig,
  ResourceEstimationsPerJob,
} from '../jobTypeTypes.js';
import type { LogFn } from '../types.js';
import {
  applyRatioTransfers,
  calculateDonorContributions,
  collectLoadMetrics,
  createInitialStates,
  identifyDonors,
  identifyReceivers,
  mergeRatioConfig,
  normalizeRatios,
  recalculateAllocatedSlots,
} from './jobTypeHelpers.js';
import {
  calculateInitialRatios,
  validateCalculatedRatios,
  validateJobTypeConfig,
} from './jobTypeValidation.js';

const ZERO = 0;
const ONE = 1;
const PRECISION_DIGITS = 4;

/**
 * Configuration for creating a JobTypeManager.
 */
export interface JobTypeManagerConfig {
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  ratioAdjustmentConfig?: RatioAdjustmentConfig;
  label: string;
  onLog?: LogFn;
}

/** Waiter in the queue for a job type slot */
interface QueuedWaiter {
  resolve: () => void;
}

/**
 * Interface for the JobTypeManager.
 */
export interface JobTypeManager {
  getState: (jobTypeId: string) => JobTypeState | undefined;
  getAllStates: () => Record<string, JobTypeState>;
  hasCapacity: (jobTypeId: string) => boolean;
  acquire: (jobTypeId: string) => Promise<void>;
  release: (jobTypeId: string) => void;
  setTotalCapacity: (totalSlots: number) => void;
  getTotalCapacity: () => number;
  adjustRatios: () => void;
  getStats: () => JobTypeStats;
  stop: () => void;
}

/** Create a no-op logger */
const createNoOpLogger = (): ((message: string, data?: Record<string, unknown>) => void) => () => undefined;

/** Create a prefixed logger */
const createPrefixedLogger =
  (label: string, onLog: LogFn): ((message: string, data?: Record<string, unknown>) => void) =>
  (msg, data) => {
    onLog(`${label}| ${msg}`, data);
  };

/**
 * Internal implementation of JobTypeManager.
 */
class JobTypeManagerImpl implements JobTypeManager {
  private readonly states: Map<string, JobTypeState>;
  private readonly config: Required<RatioAdjustmentConfig>;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;
  private readonly waitQueues: Map<string, QueuedWaiter[]>;
  private totalCapacity: number = ZERO;
  private lastAdjustmentTime: number | null = null;
  private releasesSinceAdjustment: number = ZERO;
  private adjustmentInterval: ReturnType<typeof setInterval> | null = null;

  constructor(managerConfig: JobTypeManagerConfig) {
    const { resourceEstimationsPerJob, ratioAdjustmentConfig, label, onLog } = managerConfig;

    validateJobTypeConfig(resourceEstimationsPerJob);
    const calculated = calculateInitialRatios(resourceEstimationsPerJob);
    validateCalculatedRatios(calculated);

    this.config = mergeRatioConfig(ratioAdjustmentConfig);
    this.log = onLog === undefined ? createNoOpLogger() : createPrefixedLogger(label, onLog);
    this.states = createInitialStates(resourceEstimationsPerJob, calculated.ratios);
    this.waitQueues = new Map(Array.from(this.states.keys()).map((id) => [id, []]));

    this.log('JobTypeManager initialized', {
      jobTypes: Array.from(this.states.keys()),
      ratios: Object.fromEntries(calculated.ratios),
    });

    this.startPeriodicAdjustment();
  }

  private startPeriodicAdjustment(): void {
    if (this.config.adjustmentIntervalMs > ZERO) {
      this.adjustmentInterval = setInterval(() => {
        this.adjustRatios();
      }, this.config.adjustmentIntervalMs);
    }
  }

  getState(jobTypeId: string): JobTypeState | undefined {
    return this.states.get(jobTypeId);
  }

  getAllStates(): Record<string, JobTypeState> {
    const result: Record<string, JobTypeState> = {};
    for (const [id, state] of this.states) {
      result[id] = { ...state };
    }
    return result;
  }

  hasCapacity(jobTypeId: string): boolean {
    const state = this.states.get(jobTypeId);
    return state !== undefined && state.inFlight < state.allocatedSlots;
  }

  async acquire(jobTypeId: string): Promise<void> {
    const state = this.states.get(jobTypeId);
    if (state === undefined) {
      throw new Error(`Unknown job type: ${jobTypeId}`);
    }

    const queue = this.waitQueues.get(jobTypeId);
    if (queue === undefined) {
      throw new Error(`No wait queue for job type: ${jobTypeId}`);
    }

    // If capacity available and no one waiting, acquire immediately
    if (state.inFlight < state.allocatedSlots && queue.length === ZERO) {
      state.inFlight += ONE;
      this.log('Acquired slot', {
        jobTypeId,
        inFlight: state.inFlight,
        allocatedSlots: state.allocatedSlots,
      });
      return;
    }

    // Otherwise, wait in queue
    const { promise, resolve } = Promise.withResolvers<void>();
    queue.push({ resolve });
    this.log('Waiting for slot', { jobTypeId, queueLength: queue.length });
    await promise;
  }

  release(jobTypeId: string): void {
    const state = this.states.get(jobTypeId);
    if (state === undefined || state.inFlight <= ZERO) {
      return;
    }

    const queue = this.waitQueues.get(jobTypeId);
    const nextWaiter = queue?.[ZERO];

    if (nextWaiter !== undefined && state.inFlight <= state.allocatedSlots) {
      // Transfer slot directly to next waiter (don't decrement inFlight)
      queue?.shift();
      this.log('Transferred slot to waiter', {
        jobTypeId,
        inFlight: state.inFlight,
        queueLength: queue?.length,
      });
      nextWaiter.resolve();
    } else {
      // No waiter, just release the slot
      state.inFlight -= ONE;
      this.log('Released slot', {
        jobTypeId,
        inFlight: state.inFlight,
        allocatedSlots: state.allocatedSlots,
      });
    }

    this.releasesSinceAdjustment += ONE;
    this.maybeAdjustOnRelease();
  }

  private maybeAdjustOnRelease(): void {
    const shouldAdjust =
      this.config.releasesPerAdjustment > ZERO &&
      this.releasesSinceAdjustment >= this.config.releasesPerAdjustment;
    if (shouldAdjust) {
      this.adjustRatios();
    }
  }

  setTotalCapacity(totalSlots: number): void {
    this.totalCapacity = Math.max(ZERO, totalSlots);
    recalculateAllocatedSlots(this.states, this.totalCapacity);
    this.log('Total capacity updated', { totalSlots: this.totalCapacity });
  }

  getTotalCapacity(): number {
    return this.totalCapacity;
  }

  adjustRatios(): void {
    this.releasesSinceAdjustment = ZERO;
    const metrics = collectLoadMetrics(this.states);
    const donors = identifyDonors(metrics, this.config.lowLoadThreshold, this.config.minRatio);
    const receivers = identifyReceivers(metrics, this.config.highLoadThreshold);

    if (donors.length === ZERO || receivers.length === ZERO) {
      return;
    }

    const donorContributions = calculateDonorContributions(donors, this.states, this.config);
    let availableToTransfer = ZERO;
    for (const contribution of donorContributions.values()) {
      availableToTransfer += contribution;
    }

    if (availableToTransfer <= ZERO) {
      return;
    }

    applyRatioTransfers(this.states, donorContributions, receivers, availableToTransfer);
    normalizeRatios(this.states);
    recalculateAllocatedSlots(this.states, this.totalCapacity);
    this.lastAdjustmentTime = Date.now();
    this.logAdjustment(donors, receivers);
  }

  private logAdjustment(donors: JobTypeLoadMetrics[], receivers: JobTypeLoadMetrics[]): void {
    this.log('Ratios adjusted', {
      ratios: Object.fromEntries(
        Array.from(this.states.entries()).map(([id, s]) => [id, s.currentRatio.toFixed(PRECISION_DIGITS)])
      ),
      donors: donors.map((d) => d.jobTypeId),
      receivers: receivers.map((r) => r.jobTypeId),
    });
  }

  getStats(): JobTypeStats {
    return {
      jobTypes: this.getAllStates(),
      totalSlots: this.totalCapacity,
      lastAdjustmentTime: this.lastAdjustmentTime,
    };
  }

  stop(): void {
    if (this.adjustmentInterval !== null) {
      clearInterval(this.adjustmentInterval);
      this.adjustmentInterval = null;
    }
    this.log('JobTypeManager stopped');
  }
}

/** Create a new JobTypeManager. */
export const createJobTypeManager = (config: JobTypeManagerConfig): JobTypeManager =>
  new JobTypeManagerImpl(config);
