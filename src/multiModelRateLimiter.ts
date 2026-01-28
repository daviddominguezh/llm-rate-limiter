/** LLM Rate Limiter with per-model limits and automatic fallback. */
import { AvailabilityTracker } from '@globalUtils/availabilityTracker.js';
import { DelegationError, buildJobArgs, calculateMaxEstimatedResource, calculateTotalCost, isDelegationError, waitForModelCapacity } from '@globalUtils/jobExecutionHelpers.js';
import { type MemoryManagerInstance, createMemoryManager } from '@globalUtils/memoryManager.js';
import { buildModelLimiterConfig, getEffectiveOrder, validateMultiModelConfig } from '@globalUtils/multiModelHelpers.js';
import type { AllocationInfo, ArgsWithoutModelId, Availability, AvailabilityChangeReason, BackendConfig, BackendEstimatedResources, DistributedAvailability, DistributedBackendConfig, JobCallbackContext, JobExecutionContext, JobUsage, LLMJobResult, LLMRateLimiterConfig, LLMRateLimiterInstance, LLMRateLimiterStats, ModelsConfig, QueueJobOptions, RelativeAvailabilityAdjustment, Unsubscribe, UsageEntry, ValidatedLLMRateLimiterConfig } from './multiModelTypes.js';
import { createInternalLimiter } from './rateLimiter.js';
import type { InternalJobResult, InternalLimiterConfig, InternalLimiterInstance, InternalLimiterStats } from './types.js';
const ZERO = 0;
const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LABEL = 'LLMRateLimiter';
const INSTANCE_ID_RADIX = 36;
const INSTANCE_ID_START = 2;
const INSTANCE_ID_END = 11;

/** Check if the backend is V2 (has register method) */
const isV2Backend = (backend: BackendConfig | DistributedBackendConfig): backend is DistributedBackendConfig =>
  'register' in backend && typeof backend.register === 'function';

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
    this.modelLimiters = new Map();
    this.instanceId = `inst-${Date.now()}-${Math.random().toString(INSTANCE_ID_RADIX).slice(INSTANCE_ID_START, INSTANCE_ID_END)}`;
    const { models, backend } = config;
    this.backend = backend;
    const estimatedUsedMemoryKB = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedUsedMemoryKB
    );
    this.estimatedUsedTokens = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedUsedTokens
    );
    this.estimatedNumberOfRequests = calculateMaxEstimatedResource(
      models,
      (m) => m.resourcesPerEvent?.estimatedNumberOfRequests
    );
    this.memoryManager = createMemoryManager({
      config,
      label: this.label,
      estimatedUsedMemoryKB,
      onLog: config.onLog,
      onAvailabilityChange: (r) => {
        this.emitAvailabilityChange(r);
      },
    });
    this.initializeModelLimiters();
    this.availabilityTracker = this.initializeAvailabilityTracker(estimatedUsedMemoryKB);
    this.log('Initialized', { models: this.order });
  }
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) { this.config.onLog(`${this.label}| ${message}`, data); }
  }

  /** Get the unique instance ID for this rate limiter */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Start the rate limiter and register with V2 distributed backend if configured.
   * For V1 backends or no backend, this is a no-op.
   */
  async start(): Promise<void> {
    if (this.backend === undefined || !isV2Backend(this.backend)) { return; }
    const allocation = await this.backend.register(this.instanceId);
    this.availabilityTracker?.setDistributedAllocation(allocation);
    this.backendUnsubscribe = this.backend.subscribe(this.instanceId, (alloc: AllocationInfo) => {
      this.availabilityTracker?.setDistributedAllocation(alloc);
    });
    this.log('Registered with V2 backend', { instanceId: this.instanceId, slots: allocation.slots });
  }

  private initializeAvailabilityTracker(estimatedUsedMemoryKB: number): AvailabilityTracker | null {
    if (this.config.onAvailableSlotsChange === undefined) { return null; }
    const tracker = new AvailabilityTracker({
      callback: this.config.onAvailableSlotsChange, getStats: () => this.getStats(),
      estimatedResources: { estimatedUsedTokens: this.estimatedUsedTokens, estimatedNumberOfRequests: this.estimatedNumberOfRequests, estimatedUsedMemoryKB },
    });
    tracker.initialize();
    return tracker;
  }

  private emitAvailabilityChange(reason: AvailabilityChangeReason): void {
    this.availabilityTracker?.checkAndEmit(reason);
  }
  private emitAdjustment(adjustment: RelativeAvailabilityAdjustment): void {
    this.availabilityTracker?.emitAdjustment(adjustment);
  }

  private emitJobAdjustment(modelId: string, result: InternalJobResult): void {
    if (this.availabilityTracker === null) { return; }
    const resources = this.config.models[modelId]?.resourcesPerEvent;
    const tokenDiff = result.usage.input + result.usage.output - (resources?.estimatedUsedTokens ?? ZERO);
    const requestDiff = result.requestCount - (resources?.estimatedNumberOfRequests ?? ZERO);
    if (tokenDiff === ZERO && requestDiff === ZERO) { return; }
    this.emitAdjustment({ tokensPerMinute: tokenDiff, tokensPerDay: tokenDiff, requestsPerMinute: requestDiff, requestsPerDay: requestDiff, memoryKB: ZERO, concurrentRequests: ZERO });
  }

  private initializeModelLimiters(): void {
    for (const [modelId, modelConfig] of Object.entries(this.config.models)) {
      const limiterConfig = buildModelLimiterConfig(
        modelId,
        modelConfig as InternalLimiterConfig,
        this.label,
        this.config.onLog
      );
      this.modelLimiters.set(modelId, createInternalLimiter(limiterConfig));
    }
  }

  private getModelLimiter(modelId: string): InternalLimiterInstance {
    const limiter = this.modelLimiters.get(modelId);
    if (limiter === undefined) { throw new Error(`Unknown model: ${modelId}`); }
    return limiter;
  }

  private calculateCost(modelId: string, usage: UsageEntry): number {
    const defaultPricing = { input: ZERO, cached: ZERO, output: ZERO };
    const { input, cached, output } = this.config.models[modelId]?.pricing ?? defaultPricing;
    return (usage.inputTokens * input + usage.cachedTokens * cached + usage.outputTokens * output) / TOKENS_PER_MILLION;
  }

  private addUsageWithCost(ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry): void {
    ctx.usage.push({ ...usage, cost: this.calculateCost(modelId, usage) });
  }

  private getEstimatedResourcesForBackend(modelId: string): BackendEstimatedResources {
    const resources = this.config.models[modelId]?.resourcesPerEvent;
    return { requests: resources?.estimatedNumberOfRequests ?? ZERO, tokens: resources?.estimatedUsedTokens ?? ZERO };
  }

  private async acquireBackend(modelId: string, jobId: string): Promise<boolean> {
    if (this.backend === undefined) { return true; }
    const baseContext = { modelId, jobId, estimated: this.getEstimatedResourcesForBackend(modelId) };
    if (isV2Backend(this.backend)) {
      return await this.backend.acquire({ ...baseContext, instanceId: this.instanceId });
    }
    return await this.backend.acquire(baseContext);
  }
  private releaseBackend(modelId: string, jobId: string, actual: { requests: number; tokens: number }): void {
    if (this.backend === undefined) { return; }
    const baseContext = { modelId, jobId, estimated: this.getEstimatedResourcesForBackend(modelId), actual };
    if (isV2Backend(this.backend)) {
      this.backend.release({ ...baseContext, instanceId: this.instanceId }).catch(() => { /* User handles errors */ });
      return;
    }
    this.backend.release(baseContext).catch(() => { /* User handles errors */ });
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

  async queueJob<T extends InternalJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(options: QueueJobOptions<T, Args>): Promise<LLMJobResult<T>> {
    const ctx: JobExecutionContext<T, Args> = { jobId: options.jobId, job: options.job, args: options.args, triedModels: new Set<string>(), usage: [], onComplete: options.onComplete, onError: options.onError };
    return await this.executeJobWithDelegation(ctx);
  }

  private async executeJobWithDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(ctx: JobExecutionContext<T, Args>): Promise<LLMJobResult<T>> {
    const selectedModel = this.getAvailableModelExcluding(ctx.triedModels) ?? (await waitForModelCapacity((exclude) => this.getAvailableModelExcluding(exclude), ctx.triedModels, DEFAULT_POLL_INTERVAL_MS));
    ctx.triedModels.add(selectedModel);
    await this.memoryManager?.acquire(selectedModel);
    const backendAcquired = await this.acquireBackend(selectedModel, ctx.jobId);
    if (!backendAcquired) { return await this.handleBackendRejection(ctx, selectedModel); }
    try { return await this.executeJobOnModel(ctx, selectedModel); }
    catch (error) { return await this.handleExecutionError(ctx, selectedModel, error); }
  }
  private async handleBackendRejection<T extends InternalJobResult, Args extends ArgsWithoutModelId>(ctx: JobExecutionContext<T, Args>, modelId: string): Promise<LLMJobResult<T>> {
    this.memoryManager?.release(modelId);
    if (ctx.triedModels.size >= this.order.length) { throw new Error('All models rejected by backend'); }
    return await this.executeJobWithDelegation(ctx);
  }
  private async handleExecutionError<T extends InternalJobResult, Args extends ArgsWithoutModelId>(ctx: JobExecutionContext<T, Args>, modelId: string, error: unknown): Promise<LLMJobResult<T>> {
    this.memoryManager?.release(modelId);
    this.releaseBackend(modelId, ctx.jobId, { requests: ZERO, tokens: ZERO });
    if (isDelegationError(error)) { return await this.handleDelegation(ctx); }
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (ctx.onError !== undefined) {
      const cbCtx: JobCallbackContext = { jobId: ctx.jobId, totalCost: calculateTotalCost(ctx.usage), usage: ctx.usage };
      ctx.onError(errorObj, cbCtx);
    }
    throw errorObj;
  }

  private async executeJobOnModel<T extends InternalJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>, modelId: string
  ): Promise<LLMJobResult<T>> {
    const limiter = this.getModelLimiter(modelId);
    let callbackCalled = false;
    let shouldDelegate = false;
    let rejectedWithoutDelegation = false;
    const handleResolve = (usage: UsageEntry): void => { callbackCalled = true; this.addUsageWithCost(ctx, modelId, usage); };
    const handleReject = (usage: UsageEntry, opts?: { delegate?: boolean }): void => {
      callbackCalled = true; this.addUsageWithCost(ctx, modelId, usage);
      shouldDelegate = opts?.delegate !== false;
      if (!shouldDelegate) { rejectedWithoutDelegation = true; }
    };
    this.emitAvailabilityChange('tokensMinute');
    const result = await limiter.queueJob(async () => {
      const jobArgs = buildJobArgs<Args>(modelId, ctx.args);
      const jobResult = await ctx.job(jobArgs, handleResolve, handleReject);
      if (!callbackCalled) { throw new Error('Job must call resolve() or reject()'); }
      if (rejectedWithoutDelegation) { throw new Error('Job rejected without delegation'); }
      if (shouldDelegate) { throw new DelegationError(); }
      return jobResult;
    });
    this.emitJobAdjustment(modelId, result);
    this.memoryManager?.release(modelId);
    this.releaseBackend(modelId, ctx.jobId, { requests: result.requestCount, tokens: result.usage.input + result.usage.output });
    const finalResult = { ...result, modelUsed: modelId };
    const callbackContext: JobCallbackContext = { jobId: ctx.jobId, totalCost: calculateTotalCost(ctx.usage), usage: ctx.usage };
    if (ctx.onComplete !== undefined) { ctx.onComplete(finalResult, callbackContext); }
    return finalResult;
  }

  private async handleDelegation<T extends InternalJobResult, Args extends ArgsWithoutModelId>(ctx: JobExecutionContext<T, Args>): Promise<LLMJobResult<T>> {
    if (this.getAvailableModelExcluding(ctx.triedModels) === null) { ctx.triedModels.clear(); }
    return await this.executeJobWithDelegation(ctx);
  }

  async queueJobForModel<T extends InternalJobResult>(modelId: string, job: () => Promise<T> | T): Promise<T> {
    const limiter = this.getModelLimiter(modelId);
    await this.memoryManager?.acquire(modelId);
    try { return await limiter.queueJob(job); } finally { this.memoryManager?.release(modelId); }
  }

  getStats(): LLMRateLimiterStats {
    const modelStats: Record<string, InternalLimiterStats> = {};
    for (const [modelId, limiter] of this.modelLimiters) { modelStats[modelId] = limiter.getStats(); }
    return { models: modelStats, memory: this.memoryManager?.getStats() };
  }

  getModelStats(modelId: string): InternalLimiterStats {
    const mem = this.memoryManager?.getStats();
    return mem === undefined
      ? this.getModelLimiter(modelId).getStats()
      : { ...this.getModelLimiter(modelId).getStats(), memory: mem };
  }

  setDistributedAvailability(availability: DistributedAvailability): void {
    if (this.config.onAvailableSlotsChange === undefined) { return; }
    const fullAvailability: Availability = { slots: availability.slots, tokensPerMinute: availability.tokensPerMinute ?? null, tokensPerDay: availability.tokensPerDay ?? null, requestsPerMinute: availability.requestsPerMinute ?? null, requestsPerDay: availability.requestsPerDay ?? null, concurrentRequests: null, memoryKB: null };
    this.config.onAvailableSlotsChange(fullAvailability, 'distributed', undefined);
  }

  stop(): void {
    this.backendUnsubscribe?.();
    this.backendUnsubscribe = null;
    if (this.backend !== undefined && isV2Backend(this.backend)) {
      this.backend.unregister(this.instanceId).catch(() => { /* User handles errors */ });
    }
    this.memoryManager?.stop();
    for (const limiter of this.modelLimiters.values()) { limiter.stop(); }
    this.log('Stopped');
  }
}

/** Create a new LLM Rate Limiter. Order is optional for single model, required for multiple. */
export const createLLMRateLimiter = <T extends ModelsConfig>(
  config: ValidatedLLMRateLimiterConfig<T>
): LLMRateLimiterInstance => new LLMRateLimiter(config as LLMRateLimiterConfig);
