/** LLM Rate Limiter with per-model limits and automatic fallback. */
import type { BackendFactoryInstance, DistributedBackendFactory } from './backendFactoryTypes.js';
import type { JobTypeStats, ResourcesPerJob } from './jobTypeTypes.js';
import type {
  ArgsWithoutModelId,
  AvailabilityChangeReason,
  BackendConfig,
  DistributedAvailability,
  DistributedBackendConfig,
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
  waitForJobTypeCapacity,
  waitForModelCapacity,
} from './utils/jobExecutionHelpers.js';
import { executeJobWithCallbacks } from './utils/jobExecutor.js';
import type { JobTypeManager } from './utils/jobTypeManager.js';
import { validateJobTypeExists } from './utils/jobTypeValidation.js';
import { type MemoryManagerInstance, createMemoryManager } from './utils/memoryManager.js';
import {
  getEffectiveOrder,
  getEffectiveResourcesPerJob,
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
  private readonly order: readonly string[];
  private readonly resourcesPerJob: ResourcesPerJob | undefined;
  private readonly modelLimiters: Map<string, InternalLimiterInstance>;
  private readonly memoryManager: MemoryManagerInstance | null;
  private readonly jobTypeManager: JobTypeManager | null;
  private readonly availabilityTracker: AvailabilityTracker | null;
  private readonly backendOrFactory:
    | BackendConfig
    | DistributedBackendConfig
    | DistributedBackendFactory
    | undefined;
  private readonly instanceId: string;
  private backendUnsubscribe: Unsubscribe | null = null;
  private backendFactoryInstance: BackendFactoryInstance | null = null;
  private resolvedBackend: BackendConfig | DistributedBackendConfig | undefined;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;
    this.order = getEffectiveOrder(config);
    this.resourcesPerJob = getEffectiveResourcesPerJob(config);
    this.instanceId = generateInstanceId();
    ({ backend: this.backendOrFactory } = config);
    const estimated = calculateEstimatedResources(this.resourcesPerJob);
    this.modelLimiters = initializeModelLimiters(config.models, this.label, config.onLog);
    this.memoryManager = createMemoryManager({
      config,
      label: this.label,
      estimatedUsedMemoryKB: estimated.estimatedUsedMemoryKB,
      onLog: config.onLog,
      onAvailabilityChange: (r) => {
        this.emitAvailabilityChange(r);
      },
    });
    this.availabilityTracker = createAvailabilityTracker(config, estimated, () => this.getStats());
    this.jobTypeManager = createOptionalJobTypeManager(
      this.resourcesPerJob,
      config.ratioAdjustmentConfig,
      this.label,
      config.onLog
    );
    initializeJobTypeCapacity(this.jobTypeManager, calculateJobTypeCapacity(config.models));

    this.log('Initialized', {
      models: this.order,
      jobTypes: getJobTypeKeysFromConfig(this.resourcesPerJob),
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
      this.resourcesPerJob,
      this.order
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
      this.log('Registered with V2 backend', { instanceId: this.instanceId, slots: allocation.slots });
    }
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason): void {
    this.availabilityTracker?.checkAndEmit(reason);
  }
  private emitJobAdjustment(jobType: string | undefined, result: InternalJobResult): void {
    const adjustment = calculateJobAdjustment(this.resourcesPerJob, jobType, result);
    if (adjustment !== null) this.availabilityTracker?.emitAdjustment(adjustment);
  }
  private getModelLimiter(modelId: string): InternalLimiterInstance {
    return getModelLimiterById(this.modelLimiters, modelId);
  }
  private backendCtx(modelId: string, jobId: string, jobType?: string): BackendOperationContext {
    return buildBackendContext({
      backend: this.resolvedBackend,
      resourcesPerJob: this.resourcesPerJob,
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
    return this.order.find((m) => this.hasCapacityForModel(m)) ?? null;
  }
  private getAvailableModelExcluding(excludeModels: ReadonlySet<string>): string | null {
    return this.order.find((m) => !excludeModels.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  async queueJob<T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<LLMJobResult<T>> {
    const { jobType } = options;
    const { jobTypeManager: manager, resourcesPerJob: cfg } = this;
    if (jobType !== undefined && cfg !== undefined) validateJobTypeExists(jobType, cfg);
    const acquired = await acquireJobTypeSlot({
      manager,
      resourcesConfig: cfg,
      jobType,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      waitForCapacity: waitForJobTypeCapacity,
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
      if (acquired && jobType !== undefined) manager?.release(jobType);
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
      if (ctx.triedModels.size >= this.order.length) throw new Error('All models rejected by backend');
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
      emitAvailabilityChange: () => {
        this.emitAvailabilityChange('tokensMinute');
      },
      emitJobAdjustment: (jt, r) => {
        this.emitJobAdjustment(jt, r);
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
      this.config.onAvailableSlotsChange(toFullAvailability(availability), 'distributed', undefined);
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
export const createLLMRateLimiter = <T extends ModelsConfig, J extends ResourcesPerJob = ResourcesPerJob>(
  config: ValidatedLLMRateLimiterConfig<T, J>
): LLMRateLimiterInstance<J extends ResourcesPerJob<infer K> ? K : string> =>
  new LLMRateLimiter(config as LLMRateLimiterConfig) as LLMRateLimiterInstance<
    J extends ResourcesPerJob<infer K> ? K : string
  >;
