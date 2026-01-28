/** LLM Rate Limiter with per-model limits and automatic fallback. */
import type { AvailabilityTracker } from '@globalUtils/availabilityTracker.js';
import {
  type BackendOperationContext,
  acquireBackend,
  isV2Backend,
  releaseBackend,
} from '@globalUtils/backendHelpers.js';
import { addUsageWithCost, calculateJobAdjustment, toFullAvailability } from '@globalUtils/costHelpers.js';
import {
  buildModelStats,
  calculateEstimatedResources,
  createAvailabilityTracker,
  getModelLimiterById,
  initializeModelLimiters,
} from '@globalUtils/initializationHelpers.js';
import {
  buildErrorCallbackContext,
  isDelegationError,
  waitForModelCapacity,
} from '@globalUtils/jobExecutionHelpers.js';
import { executeJobWithCallbacks } from '@globalUtils/jobExecutor.js';
import { type MemoryManagerInstance, createMemoryManager } from '@globalUtils/memoryManager.js';
import { getEffectiveOrder, validateMultiModelConfig } from '@globalUtils/multiModelHelpers.js';

import type {
  AllocationInfo,
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

const ZERO = 0;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LABEL = 'LLMRateLimiter';
const INSTANCE_ID_RADIX = 36;
const INSTANCE_ID_START = 2;
const INSTANCE_ID_END = 11;

class LLMRateLimiter implements LLMRateLimiterInstance {
  private readonly config: LLMRateLimiterConfig;
  private readonly label: string;
  private readonly order: readonly string[];
  private readonly modelLimiters: Map<string, InternalLimiterInstance>;
  private readonly memoryManager: MemoryManagerInstance | null;
  private readonly estimatedUsedTokens: number;
  private readonly estimatedNumberOfRequests: number;
  private readonly availabilityTracker: AvailabilityTracker | null;
  private readonly backend: BackendConfig | DistributedBackendConfig | undefined;
  private readonly instanceId: string;
  private backendUnsubscribe: Unsubscribe | null = null;

  constructor(config: LLMRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;
    this.order = getEffectiveOrder(config);
    this.instanceId = `inst-${Date.now()}-${Math.random().toString(INSTANCE_ID_RADIX).slice(INSTANCE_ID_START, INSTANCE_ID_END)}`;
    ({ backend: this.backend } = config);
    const { estimatedUsedTokens, estimatedNumberOfRequests, estimatedUsedMemoryKB } =
      calculateEstimatedResources(config.models);
    this.estimatedUsedTokens = estimatedUsedTokens;
    this.estimatedNumberOfRequests = estimatedNumberOfRequests;
    this.modelLimiters = initializeModelLimiters(config.models, this.label, config.onLog);
    this.memoryManager = createMemoryManager({
      config,
      label: this.label,
      estimatedUsedMemoryKB,
      onLog: config.onLog,
      onAvailabilityChange: (r) => {
        this.emitAvailabilityChange(r);
      },
    });
    const estimated = { estimatedUsedTokens, estimatedNumberOfRequests, estimatedUsedMemoryKB };
    this.availabilityTracker = createAvailabilityTracker(config, estimated, () => this.getStats());
    this.log('Initialized', { models: this.order });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) {
      this.config.onLog(`${this.label}| ${message}`, data);
    }
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  async start(): Promise<void> {
    if (this.backend === undefined || !isV2Backend(this.backend)) {
      return;
    }
    const allocation = await this.backend.register(this.instanceId);
    this.availabilityTracker?.setDistributedAllocation(allocation);
    this.backendUnsubscribe = this.backend.subscribe(this.instanceId, (alloc: AllocationInfo) => {
      this.availabilityTracker?.setDistributedAllocation(alloc);
    });
    this.log('Registered with V2 backend', { instanceId: this.instanceId, slots: allocation.slots });
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason): void {
    this.availabilityTracker?.checkAndEmit(reason);
  }
  private emitJobAdjustment(modelId: string, result: InternalJobResult): void {
    const adjustment = calculateJobAdjustment(this.config.models, modelId, result);
    if (adjustment !== null) {
      this.availabilityTracker?.emitAdjustment(adjustment);
    }
  }
  private getModelLimiter(modelId: string): InternalLimiterInstance {
    return getModelLimiterById(this.modelLimiters, modelId);
  }

  private buildBackendContext(modelId: string, jobId: string): BackendOperationContext {
    return { backend: this.backend, models: this.config.models, instanceId: this.instanceId, modelId, jobId };
  }

  hasCapacity(): boolean {
    return this.getAvailableModel() !== null;
  }
  hasCapacityForModel(modelId: string): boolean {
    const hasLimiterCapacity = this.getModelLimiter(modelId).hasCapacity();
    const hasMemCapacity = this.memoryManager === null || this.memoryManager.hasCapacity(modelId);
    return hasLimiterCapacity && hasMemCapacity;
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
    const ctx: JobExecutionContext<T, Args> = {
      jobId: options.jobId,
      job: options.job,
      args: options.args,
      triedModels: new Set<string>(),
      usage: [],
      onComplete: options.onComplete,
      onError: options.onError,
    };
    return await this.executeJobWithDelegation(ctx);
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
    const backendCtx = this.buildBackendContext(selectedModel, ctx.jobId);
    if (!(await acquireBackend(backendCtx))) {
      return await this.handleBackendRejection(ctx, selectedModel);
    }
    try {
      return await this.executeJobOnModel(ctx, selectedModel);
    } catch (error) {
      return await this.handleExecutionError(ctx, selectedModel, error);
    }
  }

  private async handleBackendRejection<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string
  ): Promise<LLMJobResult<T>> {
    this.memoryManager?.release(modelId);
    if (ctx.triedModels.size >= this.order.length) {
      throw new Error('All models rejected by backend');
    }
    return await this.executeJobWithDelegation(ctx);
  }

  private async handleExecutionError<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string,
    error: unknown
  ): Promise<LLMJobResult<T>> {
    this.memoryManager?.release(modelId);
    releaseBackend(this.buildBackendContext(modelId, ctx.jobId), { requests: ZERO, tokens: ZERO });
    if (isDelegationError(error)) {
      return await this.handleDelegation(ctx);
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
      emitJobAdjustment: (m, r) => {
        this.emitJobAdjustment(m, r);
      },
      releaseResources: (result) => {
        this.memoryManager?.release(modelId);
        const actual = { requests: result.requestCount, tokens: result.usage.input + result.usage.output };
        releaseBackend(this.buildBackendContext(modelId, ctx.jobId), actual);
      },
    });
  }

  private async handleDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<LLMJobResult<T>> {
    if (this.getAvailableModelExcluding(ctx.triedModels) === null) {
      ctx.triedModels.clear();
    }
    return await this.executeJobWithDelegation(ctx);
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
    return { models: buildModelStats(this.modelLimiters), memory: this.memoryManager?.getStats() };
  }

  getModelStats(modelId: string): InternalLimiterStats {
    const mem = this.memoryManager?.getStats();
    return mem === undefined
      ? this.getModelLimiter(modelId).getStats()
      : { ...this.getModelLimiter(modelId).getStats(), memory: mem };
  }

  setDistributedAvailability(availability: DistributedAvailability): void {
    if (this.config.onAvailableSlotsChange === undefined) {
      return;
    }
    this.config.onAvailableSlotsChange(toFullAvailability(availability), 'distributed', undefined);
  }

  stop(): void {
    this.backendUnsubscribe?.();
    this.backendUnsubscribe = null;
    if (this.backend !== undefined && isV2Backend(this.backend)) {
      this.backend.unregister(this.instanceId).catch(() => {
        /* User handles errors */
      });
    }
    this.memoryManager?.stop();
    for (const limiter of this.modelLimiters.values()) {
      limiter.stop();
    }
    this.log('Stopped');
  }
}

/** Create a new LLM Rate Limiter. Order is optional for single model, required for multiple. */
export const createLLMRateLimiter = <T extends ModelsConfig>(
  config: ValidatedLLMRateLimiterConfig<T>
): LLMRateLimiterInstance => new LLMRateLimiter(config as LLMRateLimiterConfig);
