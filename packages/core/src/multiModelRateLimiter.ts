/** LLM Rate Limiter with per-model limits and automatic fallback. */
import type { BackendFactoryInstance, DistributedBackendFactory } from './backendFactoryTypes.js';
import type { JobTypeStats, ResourceEstimationsPerJob } from './jobTypeTypes.js';
import type {
  ActiveJobInfo,
  AllocationInfo,
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  BackendConfig,
  DistributedAvailability,
  JobExecutionContext,
  JobUsage,
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  ModelsConfig,
  QueueJobOptions,
  Unsubscribe,
  ValidatedLLMRateLimiterConfig,
} from './multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance, InternalLimiterStats } from './types.js';
import { createInitialActiveJobInfo, updateJobStatus } from './utils/activeJobTracker.js';
import type { AvailabilityTracker } from './utils/availabilityTracker.js';
import type { BackendOperationContext } from './utils/backendHelpers.js';
import { addUsageWithCost, calculateJobAdjustment, toFullAvailability } from './utils/costHelpers.js';
import {
  calculateEstimatedResources,
  calculateJobTypeCapacity,
  createAvailabilityTracker,
  getModelLimiterById,
  initializeModelLimiters,
} from './utils/initializationHelpers.js';
import type { DelegationContext } from './utils/jobDelegation.js';
import { executeWithDelegation } from './utils/jobDelegation.js';
import type { JobTypeManager } from './utils/jobTypeManager.js';
import { validateJobTypeExists } from './utils/jobTypeValidation.js';
import { type MemoryManagerInstance, createMemoryManager } from './utils/memoryManager.js';
import {
  getEffectiveOrder,
  getEffectiveResourceEstimationsPerJob,
  validateMultiModelConfig,
} from './utils/multiModelHelpers.js';
import {
  DEFAULT_LABEL,
  acquireJobTypeSlot,
  buildBackendContext,
  buildCombinedStats,
  checkJobTypeCapacity,
  createOptionalJobTypeManager,
  generateInstanceId,
  getJobTypeKeysFromConfig,
  getJobTypeStatsFromManager,
  getModelStatsWithMemory,
  initializeBackendFactory,
  initializeJobTypeCapacity,
  registerWithBackend,
  stopAllResources,
  stopBackendFactory,
  unregisterFromBackend,
} from './utils/rateLimiterOperations.js';

class LLMRateLimiter implements LLMRateLimiterInstance<string> {
  private readonly config: LLMRateLimiterConfig;
  private readonly label: string;
  private readonly escalationOrder: readonly string[];
  private readonly resourceEstimationsPerJob: ResourceEstimationsPerJob;
  private readonly modelLimiters: Map<string, InternalLimiterInstance>;
  private readonly memoryManager: MemoryManagerInstance | null;
  private readonly jobTypeManager: JobTypeManager | null;
  private readonly availabilityTracker: AvailabilityTracker | null;
  private readonly backendOrFactory: BackendConfig | DistributedBackendFactory | undefined;
  private readonly instanceId: string;
  private readonly activeJobs = new Map<string, ActiveJobInfo>();
  private backendUnsubscribe: Unsubscribe | null = null;
  private backendFactoryInstance: BackendFactoryInstance | null = null;
  private resolvedBackend: BackendConfig | undefined;
  private currentInstanceCount = 0;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = DEFAULT_LABEL;
    this.escalationOrder = getEffectiveOrder(config);
    this.resourceEstimationsPerJob = getEffectiveResourceEstimationsPerJob(config);
    this.instanceId = generateInstanceId();
    ({ backend: this.backendOrFactory } = config);
    const estimated = calculateEstimatedResources(this.resourceEstimationsPerJob);
    this.modelLimiters = initializeModelLimiters(
      config.models,
      this.label,
      config.onLog,
      estimated,
      config.onOverage
    );
    this.memoryManager = createMemoryManager({
      config,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      label: this.label,
      onLog: config.onLog,
      onAvailabilityChange: (r, modelId) => {
        this.emitAvailabilityChange(r, modelId);
      },
    });
    this.availabilityTracker = createAvailabilityTracker(config, estimated, () => this.getStats());
    this.jobTypeManager = createOptionalJobTypeManager(
      this.resourceEstimationsPerJob,
      config.ratioAdjustmentConfig,
      this.label,
      config.onLog,
      (ratios) => {
        this.memoryManager?.setRatios(ratios);
      }
    );
    const jobTypeCapacity = calculateJobTypeCapacity(config.models, this.resourceEstimationsPerJob);
    initializeJobTypeCapacity(this.jobTypeManager, jobTypeCapacity);

    this.log('Initialized', {
      models: this.escalationOrder,
      jobTypes: getJobTypeKeysFromConfig(this.resourceEstimationsPerJob),
      jobTypeCapacity,
    });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    this.config.onLog?.(`${this.label}| ${message}`, data);
  }
  getInstanceId(): string {
    return this.instanceId;
  }
  async start(): Promise<void> {
    const { factoryInstance, resolvedBackend } = await initializeBackendFactory(
      this.backendOrFactory,
      this.config.models,
      this.resourceEstimationsPerJob,
      this.escalationOrder
    );
    this.backendFactoryInstance = factoryInstance;
    this.resolvedBackend = resolvedBackend;
    const { unsubscribe, allocation } = await registerWithBackend(
      this.resolvedBackend,
      this.instanceId,
      this.availabilityTracker,
      (alloc) => {
        this.applyAllocationToLimiters(alloc);
      }
    );
    this.backendUnsubscribe = unsubscribe;
    if (allocation !== null) {
      this.applyAllocationToLimiters(allocation);
      this.log('Registered with backend', {
        instanceId: this.instanceId,
        instanceCount: allocation.instanceCount,
      });
    }
  }

  /**
   * Apply distributed allocation limits to all model limiters.
   * Divides each model's configured TPM/RPM by the number of instances.
   * Only applies if instanceCount >= current to avoid race conditions.
   */
  private applyAllocationToLimiters(allocation: AllocationInfo): void {
    const { instanceCount, dynamicLimits } = allocation;
    // Debug: log raw allocation
    console.log(`[DEBUG] applyAllocationToLimiters called:`, JSON.stringify(allocation));

    if (instanceCount <= 0) {
      console.log(`[DEBUG] instanceCount <= 0, skipping`);
      return;
    }

    // Only apply if instanceCount >= current (avoid stale allocation overwriting newer one)
    if (instanceCount < this.currentInstanceCount) {
      console.log(
        `[DEBUG] Skipping stale allocation: received instanceCount=${instanceCount}, current=${this.currentInstanceCount}`
      );
      return;
    }

    this.currentInstanceCount = instanceCount;
    this.log('Applying distributed allocation', {
      instanceCount,
      hasDynamicLimits: dynamicLimits !== undefined,
    });

    for (const [modelId, limiter] of this.modelLimiters) {
      const modelConfig = this.config.models[modelId];
      if (modelConfig === undefined) continue;

      // Use dynamicLimits when present (based on actual global usage), otherwise divide config by instanceCount
      const modelDynamic = dynamicLimits?.[modelId];

      const perInstanceTPM =
        modelDynamic?.tokensPerMinute ??
        (modelConfig.tokensPerMinute !== undefined
          ? Math.floor(modelConfig.tokensPerMinute / instanceCount)
          : undefined);
      const perInstanceRPM =
        modelDynamic?.requestsPerMinute ??
        (modelConfig.requestsPerMinute !== undefined
          ? Math.floor(modelConfig.requestsPerMinute / instanceCount)
          : undefined);
      const perInstanceTPD =
        modelDynamic?.tokensPerDay ??
        (modelConfig.tokensPerDay !== undefined
          ? Math.floor(modelConfig.tokensPerDay / instanceCount)
          : undefined);
      const perInstanceRPD =
        modelDynamic?.requestsPerDay ??
        (modelConfig.requestsPerDay !== undefined
          ? Math.floor(modelConfig.requestsPerDay / instanceCount)
          : undefined);

      console.log(
        `[DEBUG] Model ${modelId}: perInstanceTPM=${perInstanceTPM}, perInstanceRPM=${perInstanceRPM}, perInstanceTPD=${perInstanceTPD}, perInstanceRPD=${perInstanceRPD}`
      );
      this.log(`Model ${modelId} limits`, { perInstanceTPM, perInstanceRPM, perInstanceTPD, perInstanceRPD });
      limiter.setRateLimits({
        tokensPerMinute: perInstanceTPM,
        requestsPerMinute: perInstanceRPM,
        tokensPerDay: perInstanceTPD,
        requestsPerDay: perInstanceRPD,
      });
    }
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason, modelId: string): void {
    this.availabilityTracker?.checkAndEmit(reason, modelId);
  }
  private emitJobAdjustment(jobType: string, result: InternalJobResult, modelId: string): void {
    const adj = calculateJobAdjustment(this.resourceEstimationsPerJob, jobType, result);
    if (adj !== null) {
      this.availabilityTracker?.emitAdjustment(adj, modelId);
    }
  }
  private getModelLimiter(modelId: string): InternalLimiterInstance {
    return getModelLimiterById(this.modelLimiters, modelId);
  }
  private backendCtx(modelId: string, jobId: string, jobType: string): BackendOperationContext {
    return buildBackendContext({
      backend: this.resolvedBackend,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      instanceId: this.instanceId,
      modelId,
      jobId,
      jobType,
    });
  }
  hasCapacity(): boolean {
    return this.getAvailableModel() !== null;
  }
  hasCapacityForModel(modelId: string): boolean {
    // Note: Memory capacity is checked per-job-type during acquire, not per-model
    return this.getModelLimiter(modelId).hasCapacity();
  }
  getAvailableModel(): string | null {
    return this.escalationOrder.find((m) => this.hasCapacityForModel(m)) ?? null;
  }
  private getAvailableModelExcluding(exclude: ReadonlySet<string>): string | null {
    return this.escalationOrder.find((m) => !exclude.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  async queueJob<T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<LLMJobResult<T>> {
    const { jobId, jobType, job } = options;
    const { jobTypeManager: manager, resourceEstimationsPerJob: cfg } = this;
    validateJobTypeExists(jobType, cfg);

    this.activeJobs.set(jobId, createInitialActiveJobInfo(jobId, jobType, Date.now()));
    const acquired = await acquireJobTypeSlot({ manager, resourcesConfig: cfg, jobType });
    updateJobStatus(this.activeJobs, jobId, 'waiting-for-model');

    const usage: JobUsage = [];
    const ctx: JobExecutionContext<T, Args> = {
      jobId,
      jobType,
      job,
      args: options.args,
      triedModels: new Set<string>(),
      usage,
      onComplete: options.onComplete,
      onError: options.onError,
    };
    try {
      return await executeWithDelegation(this.buildDelegationContext(), ctx);
    } finally {
      if (acquired) {
        manager?.release(jobType);
      }
      this.activeJobs.delete(jobId);
    }
  }

  private buildDelegationContext(): DelegationContext {
    return {
      escalationOrder: this.escalationOrder,
      resourceEstimationsPerJob: this.resourceEstimationsPerJob,
      activeJobs: this.activeJobs,
      memoryManager: this.memoryManager,
      hasCapacityForModel: (m) => this.hasCapacityForModel(m),
      tryReserveForModel: (m) => this.getModelLimiter(m).tryReserve(),
      releaseReservationForModel: (m, ctx) => {
        this.getModelLimiter(m).releaseReservation(ctx);
      },
      getAvailableModelExcluding: (e) => this.getAvailableModelExcluding(e),
      backendCtx: (m, j, t) => this.backendCtx(m, j, t),
      getModelLimiter: (m) => this.getModelLimiter(m),
      addUsageWithCost: (c, m, u) => {
        addUsageWithCost(this.config.models, c, m, u);
      },
      emitAvailabilityChange: (r, m) => {
        this.availabilityTracker?.checkAndEmit(r, m);
      },
      emitJobAdjustment: (jt, r, m) => {
        this.emitJobAdjustment(jt, r, m);
      },
    };
  }

  async queueJobForModel<T extends InternalJobResult>(
    modelId: string,
    job: () => Promise<T> | T
  ): Promise<T> {
    const limiter = this.getModelLimiter(modelId);
    await this.memoryManager?.acquire(modelId);
    try {
      return await limiter.queueJob(job);
    } finally {
      this.memoryManager?.release(modelId);
    }
  }

  getStats(): LLMRateLimiterStats {
    return buildCombinedStats(this.modelLimiters, this.memoryManager, this.jobTypeManager);
  }
  hasCapacityForJobType(jobType: string): boolean {
    return checkJobTypeCapacity(this.jobTypeManager, jobType);
  }
  getJobTypeStats(): JobTypeStats | undefined {
    return getJobTypeStatsFromManager(this.jobTypeManager);
  }
  getModelStats(modelId: string): InternalLimiterStats {
    return getModelStatsWithMemory(this.getModelLimiter(modelId), this.memoryManager);
  }
  getActiveJobs(): ActiveJobInfo[] {
    return Array.from(this.activeJobs.values());
  }

  getAllocation(): AllocationInfo | null {
    return this.availabilityTracker?.getDistributedAllocation() ?? null;
  }

  setDistributedAvailability(availability: DistributedAvailability): void {
    if (this.config.onAvailableSlotsChange !== undefined) {
      this.config.onAvailableSlotsChange(toFullAvailability(availability), 'distributed', '*', undefined);
    }
  }
  stop(): void {
    this.backendUnsubscribe?.();
    this.backendUnsubscribe = null;
    unregisterFromBackend(this.resolvedBackend, this.instanceId);
    stopAllResources(this.modelLimiters, this.memoryManager, this.jobTypeManager);
    this.backendFactoryInstance = stopBackendFactory(this.backendFactoryInstance);
    this.log('Stopped');
  }
}
/** Create a new LLM Rate Limiter with optional job type support. */
export const createLLMRateLimiter = <
  T extends ModelsConfig,
  J extends ResourceEstimationsPerJob = ResourceEstimationsPerJob,
>(
  config: ValidatedLLMRateLimiterConfig<T, J>
): LLMRateLimiterInstance<J extends ResourceEstimationsPerJob<infer K> ? K : string> =>
  new LLMRateLimiter(config as LLMRateLimiterConfig) as LLMRateLimiterInstance<
    J extends ResourceEstimationsPerJob<infer K> ? K : string
  >;
