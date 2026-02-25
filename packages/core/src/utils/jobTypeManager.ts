/**
 * Job Type Manager - Manages job type state, capacity allocation, and dynamic ratio adjustment.
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type { JobTypeState, JobTypeStats, RatioAdjustmentConfig } from '../jobTypeTypes.js';
import { validateCapacityInvariant } from './capacityInvariantCheck.js';
import {
  applyMemoryConstraints,
  applyRatioTransfers,
  buildCapacityParams,
  calculateDonorContributions,
  collectLoadMetrics,
  collectPrimaryModelLoadMetrics,
  createInitialStates,
  decayToInitialRatios,
  drainWaitQueues,
  identifyDonors,
  identifyReceivers,
  logRatioAdjustment,
  mergeRatioConfig,
  normalizeRatios,
  recalculateAllocatedSlots,
} from './jobTypeHelpers.js';
import type { JobTypeManager, JobTypeManagerConfig, QueuedWaiter } from './jobTypeManagerTypes.js';
import { type ModelJobTypeTracker, createModelJobTypeTracker } from './jobTypeModelState.js';
import { calculateModelJobTypeSlots } from './jobTypeSlotCalculation.js';
import {
  calculateInitialRatios,
  validateCalculatedRatios,
  validateJobTypeConfig,
} from './jobTypeValidation.js';

export type { JobTypeManager, JobTypeManagerConfig, OnRatioChangeCallback } from './jobTypeManagerTypes.js';

const ZERO = 0;
const ONE = 1;

/**
 * Internal implementation of JobTypeManager.
 */
class JobTypeManagerImpl implements JobTypeManager {
  private readonly states: Map<string, JobTypeState>;
  private readonly config: Required<RatioAdjustmentConfig>;
  private readonly log: (message: string, data?: Record<string, unknown>) => void;
  private readonly waitQueues: Map<string, QueuedWaiter[]>;
  private readonly onRatioChange?: (ratios: Map<string, number>) => void;
  private readonly onModelCapacityRelease?: (modelId: string) => void;
  private readonly modelState: ModelJobTypeTracker;
  private readonly primaryModelId: string | undefined;
  private totalCapacity: number = ZERO;
  private memoryCapacityKB: number | null = null;
  private lastAdjustmentTime: number | null = null;
  private releasesSinceAdjustment: number = ZERO;
  private adjustmentInterval: ReturnType<typeof setInterval> | null = null;

  constructor(managerConfig: JobTypeManagerConfig) {
    const {
      resourceEstimationsPerJob,
      ratioAdjustmentConfig,
      label,
      primaryModelId,
      onLog,
      onRatioChange,
      onModelCapacityRelease,
    } = managerConfig;
    this.primaryModelId = primaryModelId;
    this.onRatioChange = onRatioChange;
    this.onModelCapacityRelease = onModelCapacityRelease;
    this.modelState = createModelJobTypeTracker();

    validateJobTypeConfig(resourceEstimationsPerJob);
    const calculated = calculateInitialRatios(resourceEstimationsPerJob);
    validateCalculatedRatios(calculated);

    this.config = mergeRatioConfig(ratioAdjustmentConfig);
    this.log =
      onLog === undefined
        ? () => undefined
        : (msg, data) => {
            onLog(`${label}| ${msg}`, data);
          };
    this.states = createInitialStates(resourceEstimationsPerJob, calculated.ratios);
    this.waitQueues = new Map(Array.from(this.states.keys()).map((id) => [id, []]));

    this.log('JobTypeManager initialized', {
      jobTypes: Array.from(this.states.keys()),
      ratios: Object.fromEntries(calculated.ratios),
    });

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
    if (state.inFlight < state.allocatedSlots && queue.length === ZERO) {
      state.inFlight += ONE;
      return;
    }
    const { promise, resolve } = Promise.withResolvers<undefined>();
    queue.push({
      resolve: () => {
        resolve(undefined);
      },
    });
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
      queue?.shift();
      nextWaiter.resolve();
    } else {
      state.inFlight -= ONE;
    }
    this.releasesSinceAdjustment += ONE;
    if (
      this.releasesSinceAdjustment >= this.config.releasesPerAdjustment &&
      this.config.releasesPerAdjustment > ZERO
    ) {
      this.adjustRatios();
    }
  }

  setModelPool(modelId: string, pool: ModelPoolAllocation): void {
    this.modelState.setModelPool(modelId, pool);
    this.validateInvariant();
  }

  hasCapacityForModel(modelId: string, jobTypeId: string): boolean {
    const params = buildCapacityParams(this.states, this.config.minJobTypeCapacity, modelId, jobTypeId);
    return params !== undefined && this.modelState.hasCapacity(params);
  }

  getModelJobTypeInfo(
    modelId: string,
    jobTypeId: string
  ): { allocated: number; inFlight: number } | undefined {
    const params = buildCapacityParams(this.states, this.config.minJobTypeCapacity, modelId, jobTypeId);
    if (params === undefined) return undefined;
    return {
      allocated: this.modelState.getAllocated(params),
      inFlight: this.modelState.getInFlight(params),
    };
  }

  acquireForModel(modelId: string, jobTypeId: string): void {
    const pool = this.modelState.getModelPool(modelId);
    const state = this.states.get(jobTypeId);
    const windowMs =
      pool === undefined || state === undefined
        ? ZERO
        : calculateModelJobTypeSlots(
            pool,
            state.currentRatio,
            state.resources,
            this.config.minJobTypeCapacity
          ).windowMs;
    this.modelState.acquire(modelId, jobTypeId, windowMs);
  }

  releaseForModel(modelId: string, jobTypeId: string, hadRefund?: boolean): void {
    this.modelState.release(modelId, jobTypeId, hadRefund);
    this.onModelCapacityRelease?.(modelId);
  }

  setTotalCapacity(totalSlots: number): void {
    this.totalCapacity = Math.max(ZERO, totalSlots);
    this.applyAndDrain();
    this.notifyRatioChange();
    this.validateInvariant();
  }
  setMemoryCapacityKB(kb: number): void {
    this.memoryCapacityKB = kb;
    this.applyAndDrain();
    this.notifyRatioChange();
  }
  private notifyRatioChange(): void {
    if (this.onRatioChange === undefined) return;
    const ratios = new Map<string, number>();
    for (const [id, state] of this.states) {
      ratios.set(id, state.currentRatio);
    }
    this.onRatioChange(ratios);
  }

  getTotalCapacity(): number {
    return this.totalCapacity;
  }

  private collectMetricsForAdjustment(): ReturnType<typeof collectLoadMetrics> {
    if (this.primaryModelId !== undefined && this.modelState.hasModelPools()) {
      return collectPrimaryModelLoadMetrics({
        states: this.states,
        modelState: this.modelState,
        primaryModelId: this.primaryModelId,
        minCapacity: this.config.minJobTypeCapacity,
        waitQueues: this.waitQueues,
      });
    }
    return collectLoadMetrics(this.states, this.waitQueues);
  }

  adjustRatios(): void {
    this.releasesSinceAdjustment = ZERO;
    const metrics = this.collectMetricsForAdjustment();
    const donors = identifyDonors(metrics, this.config.lowLoadThreshold, this.config.minRatio);
    const receivers = identifyReceivers(metrics, this.config.highLoadThreshold);
    if (donors.length === ZERO || receivers.length === ZERO) {
      this.maybeDecayIdleRatios(metrics);
      return;
    }
    const contributions = calculateDonorContributions(donors, this.states, this.config);
    let availableToTransfer = ZERO;
    for (const contribution of contributions.values()) {
      availableToTransfer += contribution;
    }
    if (availableToTransfer <= ZERO) {
      return;
    }
    applyRatioTransfers(this.states, contributions, receivers, availableToTransfer);
    this.applyAndDrain();
    this.lastAdjustmentTime = Date.now();
    logRatioAdjustment(this.log, this.states, donors, receivers);
    this.notifyRatioChange();
    this.validateInvariant();
  }

  private maybeDecayIdleRatios(metrics: ReturnType<typeof collectLoadMetrics>): void {
    if (this.config.idleDecayRate <= ZERO) return;
    const allIdle = metrics.every((m) => m.loadPercentage <= ZERO);
    if (!allIdle) return;
    const decayed = decayToInitialRatios(this.states, this.config.idleDecayRate);
    if (!decayed) return;
    this.applyAndDrain();
    this.notifyRatioChange();
  }

  private applyAndDrain(): void {
    normalizeRatios(this.states);
    recalculateAllocatedSlots(this.states, this.totalCapacity, this.config.minJobTypeCapacity);
    applyMemoryConstraints(this.states, this.memoryCapacityKB, this.config.minJobTypeCapacity);
    drainWaitQueues(this.states, this.waitQueues);
  }

  getStats(): JobTypeStats {
    return {
      jobTypes: this.getAllStates(),
      totalSlots: this.totalCapacity,
      lastAdjustmentTime: this.lastAdjustmentTime,
      modelJobTypes: this.modelState.getAllModelJobTypeInfo(this.states, this.config.minJobTypeCapacity),
    };
  }

  private validateInvariant(): void {
    validateCapacityInvariant({
      modelPools: this.modelState.getModelPools(),
      states: this.states,
      minCapacity: this.config.minJobTypeCapacity,
      log: this.log,
    });
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
