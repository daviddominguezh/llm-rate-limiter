/** LLM Rate Limiter with per-model limits and automatic fallback. */
import type { BackendFactoryInstance, DistributedBackendFactory } from './backendFactoryTypes.js';
import type { JobTypeStats, ResourceEstimationsPerJob } from './jobTypeTypes.js';
import type {
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  BackendConfig,
  DistributedAvailability,
  JobExecutionContext,
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
import type { AvailabilityTracker } from './utils/availabilityTracker.js';
import { type BackendOperationContext, acquireBackend, releaseBackend } from './utils/backendHelpers.js';
import { addUsageWithCost, calculateJobAdjustment, toFullAvailability } from './utils/costHelpers.js';
import {
  calculateEstimatedResources,
  calculateJobTypeCapacity,
  createAvailabilityTracker,
  getModelLimiterById,
  initializeModelLimiters,
} from './utils/initializationHelpers.js';
import {
  buildErrorCallbackContext,
  isDelegationError,
  waitForModelCapacity,
} from './utils/jobExecutionHelpers.js';
import { executeJobWithCallbacks } from './utils/jobExecutor.js';
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
  DEFAULT_POLL_INTERVAL_MS,
  ZERO,
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

class LLMRateLimiter implements LLMRateLimiterInstance {
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
  private backendUnsubscribe: Unsubscribe | null = null;
  private backendFactoryInstance: BackendFactoryInstance | null = null;
  private resolvedBackend: BackendConfig | undefined;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = DEFAULT_LABEL;
    this.escalationOrder = getEffectiveOrder(config);
    this.resourceEstimationsPerJob = getEffectiveResourceEstimationsPerJob(config);
    this.instanceId = generateInstanceId();
    ({ backend: this.backendOrFactory } = config);
    const estimated = calculateEstimatedResources(this.resourceEstimationsPerJob);
    this.modelLimiters = initializeModelLimiters(config.models, this.label, config.onLog, estimated);
    this.memoryManager = createMemoryManager({
      config,
      label: this.label,
      estimatedUsedMemoryKB: estimated.estimatedUsedMemoryKB,
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
      config.onLog
    );
    initializeJobTypeCapacity(this.jobTypeManager, calculateJobTypeCapacity(config.models));

    this.log('Initialized', {
      models: this.escalationOrder,
      jobTypes: getJobTypeKeysFromConfig(this.resourceEstimationsPerJob),
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
      this.availabilityTracker
    );
    this.backendUnsubscribe = unsubscribe;
    if (allocation !== null) {
      this.log('Registered with backend', { instanceId: this.instanceId, slots: allocation.slots });
    }
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason, modelId: string): void {
    this.availabilityTracker?.checkAndEmit(reason, modelId);
  }
  private emitJobAdjustment(jobType: string, result: InternalJobResult, modelId: string): void {
    const adjustment = calculateJobAdjustment(this.resourceEstimationsPerJob, jobType, result);
    if (adjustment !== null) this.availabilityTracker?.emitAdjustment(adjustment, modelId);
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
    return (
      this.getModelLimiter(modelId).hasCapacity() &&
      (this.memoryManager === null || this.memoryManager.hasCapacity(modelId))
    );
  }
  getAvailableModel(): string | null {
    return this.escalationOrder.find((m) => this.hasCapacityForModel(m)) ?? null;
  }
  private getAvailableModelExcluding(excludeModels: ReadonlySet<string>): string | null {
    return this.escalationOrder.find((m) => !excludeModels.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  async queueJob<T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<LLMJobResult<T>> {
    const { jobType } = options;
    const { jobTypeManager: manager, resourceEstimationsPerJob: cfg } = this;
    validateJobTypeExists(jobType, cfg);
    const acquired = await acquireJobTypeSlot({
      manager,
      resourcesConfig: cfg,
      jobType,
    });
    const ctx: JobExecutionContext<T, Args> = {
      jobId: options.jobId,
      jobType,
      job: options.job,
      args: options.args,
      triedModels: new Set<string>(),
      usage: [],
      onComplete: options.onComplete,
      onError: options.onError,
    };
    try {
      return await this.executeJobWithDelegation(ctx);
    } finally {
      if (acquired) manager?.release(jobType);
    }
  }

  private async executeJobWithDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<LLMJobResult<T>> {
    const selectedModel =
      this.getAvailableModelExcluding(ctx.triedModels) ??
      (await waitForModelCapacity(
        (exclude) => this.getAvailableModelExcluding(exclude),
        ctx.triedModels,
        DEFAULT_POLL_INTERVAL_MS
      ));
    ctx.triedModels.add(selectedModel);
    await this.memoryManager?.acquire(selectedModel);
    if (!(await acquireBackend(this.backendCtx(selectedModel, ctx.jobId, ctx.jobType)))) {
      this.memoryManager?.release(selectedModel);
      if (ctx.triedModels.size >= this.escalationOrder.length)
        throw new Error('All models rejected by backend');
      return await this.executeJobWithDelegation(ctx);
    }
    try {
      return await this.executeJobOnModel(ctx, selectedModel);
    } catch (error) {
      return await this.handleExecutionError(ctx, selectedModel, error);
    }
  }

  private async handleExecutionError<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string,
    error: unknown
  ): Promise<LLMJobResult<T>> {
    this.memoryManager?.release(modelId);
    releaseBackend(this.backendCtx(modelId, ctx.jobId, ctx.jobType), { requests: ZERO, tokens: ZERO });
    if (isDelegationError(error)) {
      if (this.getAvailableModelExcluding(ctx.triedModels) === null) ctx.triedModels.clear();
      return await this.executeJobWithDelegation(ctx);
    }
    const errorObj = error instanceof Error ? error : new Error(String(error));
    ctx.onError?.(errorObj, buildErrorCallbackContext(ctx.jobId, ctx.usage));
    throw errorObj;
  }

  private async executeJobOnModel<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string
  ): Promise<LLMJobResult<T>> {
    return await executeJobWithCallbacks({
      ctx,
      modelId,
      limiter: this.getModelLimiter(modelId),
      addUsageWithCost: (c, m, u) => {
        addUsageWithCost(this.config.models, c, m, u);
      },
      emitAvailabilityChange: (m) => {
        this.emitAvailabilityChange('tokensMinute', m);
      },
      emitJobAdjustment: (jt, r, m) => {
        this.emitJobAdjustment(jt, r, m);
      },
      releaseResources: (result) => {
        this.memoryManager?.release(modelId);
        const actual = { requests: result.requestCount, tokens: result.usage.input + result.usage.output };
        releaseBackend(this.backendCtx(modelId, ctx.jobId, ctx.jobType), actual);
      },
    });
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
