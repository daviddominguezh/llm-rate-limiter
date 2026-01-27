/** Multi-Model LLM Rate Limiter with per-model limits and automatic fallback. */
import { getAvailableMemoryKB } from '@globalUtils/memoryUtils.js';
import { buildModelLimiterConfig, getEffectiveOrder, validateMultiModelConfig } from '@globalUtils/multiModelHelpers.js';
import { Semaphore } from '@globalUtils/semaphore.js';
import { createLLMRateLimiter } from './rateLimiter.js';
import type { LLMJobResult, LLMRateLimiterConfig, LLMRateLimiterInstance, LLMRateLimiterStats } from './types.js';
import type { ArgsWithoutModelId, JobCallbackContext, JobUsage, ModelsConfig, MultiModelJobResult,
  MultiModelRateLimiterConfig, MultiModelRateLimiterInstance, MultiModelRateLimiterStats,
  QueueJobOptions, UsageEntry, ValidatedMultiModelConfig } from './multiModelTypes.js';

/** Internal context for job execution with delegation support */
interface JobExecutionContext<T extends LLMJobResult, Args extends ArgsWithoutModelId> {
  jobId: string; job: QueueJobOptions<T, Args>['job']; args: Args | undefined; triedModels: Set<string>;
  usage: JobUsage; onComplete: ((result: MultiModelJobResult<T>, context: JobCallbackContext) => void) | undefined;
  onError: ((error: Error, context: JobCallbackContext) => void) | undefined;
}

/** Internal marker class for delegation */
class DelegationError extends Error {
  public readonly isDelegation = true;
  constructor() { super('Delegation requested'); }
}

const isDelegationError = (error: unknown): error is DelegationError =>
  error instanceof DelegationError;

/** Build job arguments by merging modelId with user-provided args. Safe assertion when args is undefined. */
function buildJobArgs<Args extends ArgsWithoutModelId>(modelId: string, args: Args | undefined): { modelId: string } & Args {
  if (args === undefined) {
    const result: { modelId: string } & ArgsWithoutModelId = { modelId };
    return result as { modelId: string } & Args;
  }
  return { modelId, ...args };
}
/** Calculate total cost from usage array */
const calculateTotalCost = (usage: JobUsage): number => usage.reduce((total, entry) => total + entry.cost, ZERO);


const ZERO = 0;
const TOKENS_PER_MILLION = 1_000_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const DEFAULT_LABEL = 'MultiModelRateLimiter';

class MultiModelRateLimiter implements MultiModelRateLimiterInstance {
  private readonly config: MultiModelRateLimiterConfig;
  private readonly label: string;
  private readonly order: readonly string[];
  private readonly modelLimiters: Map<string, LLMRateLimiterInstance>;
  private memorySemaphore: Semaphore | null = null;
  private memoryRecalculationIntervalId: NodeJS.Timeout | null = null;
  private readonly estimatedUsedMemoryKB: number;

  constructor(config: MultiModelRateLimiterConfig) {
    validateMultiModelConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;
    this.order = getEffectiveOrder(config);
    this.modelLimiters = new Map();
    this.estimatedUsedMemoryKB = this.calculateMaxEstimatedMemory();
    this.initializeMemoryLimiter();
    this.initializeModelLimiters();
    this.log('Initialized', { models: this.order });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) {
      this.config.onLog(`${this.label}| ${message}`, data);
    }
  }

  private calculateMaxEstimatedMemory(): number {
    let maxMemory = ZERO;
    for (const modelConfig of Object.values(this.config.models)) {
      const estimated = modelConfig.resourcesPerEvent?.estimatedUsedMemoryKB ?? ZERO;
      maxMemory = Math.max(maxMemory, estimated);
    }
    return maxMemory;
  }

  private initializeMemoryLimiter(): void {
    if (this.config.memory === undefined) { return; }
    if (this.estimatedUsedMemoryKB === ZERO) {
      throw new Error(
        'resourcesPerEvent.estimatedUsedMemoryKB is required in at least one model when memory limits are configured'
      );
    }
    const initialCapacity = this.calculateMemoryCapacityKB();
    const semaphore = new Semaphore(initialCapacity, `${this.label}/Memory`, this.config.onLog);
    this.memorySemaphore = semaphore;
    const intervalMs = this.config.memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
    this.memoryRecalculationIntervalId = setInterval(() => {
      const { max: currentMax } = semaphore.getStats();
      const newCapacity = this.calculateMemoryCapacityKB();
      if (newCapacity !== currentMax) { semaphore.resize(newCapacity); }
    }, intervalMs);
  }

  private calculateMemoryCapacityKB(): number {
    const { config } = this;
    const { memory, minCapacity, maxCapacity } = config;
    const freeKB = getAvailableMemoryKB();
    const ratio = memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
    const calculated = Math.floor(freeKB * ratio);
    let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
    if (maxCapacity !== undefined) { clamped = Math.min(clamped, maxCapacity); }
    return clamped;
  }

  private initializeModelLimiters(): void {
    for (const [modelId, modelConfig] of Object.entries(this.config.models)) {
      const limiterConfig = buildModelLimiterConfig(modelId, modelConfig as LLMRateLimiterConfig, this.label, this.config.onLog);
      const limiter = createLLMRateLimiter(limiterConfig);
      this.modelLimiters.set(modelId, limiter);
    }
  }

  private getModelLimiter(modelId: string): LLMRateLimiterInstance {
    const limiter = this.modelLimiters.get(modelId);
    if (limiter === undefined) { throw new Error(`Unknown model: ${modelId}`); }
    return limiter;
  }

  private getEstimatedMemoryForModel(modelId: string): number {
    const { config } = this;
    const { models } = config;
    return models[modelId]?.resourcesPerEvent?.estimatedUsedMemoryKB ?? ZERO;
  }

  private calculateCost(modelId: string, usage: UsageEntry): number {
    const p = this.config.models[modelId]?.pricing;
    if (p === undefined) { return ZERO; }
    return ((usage.inputTokens * p.input) + (usage.cachedTokens * p.cached) + (usage.outputTokens * p.output)) / TOKENS_PER_MILLION;
  }

  private addUsageWithCost(ctx: { usage: JobUsage }, modelId: string, usage: UsageEntry): void {
    ctx.usage.push({ ...usage, cost: this.calculateCost(modelId, usage) });
  }

  private hasMemoryCapacity(modelId: string): boolean {
    if (this.memorySemaphore === null) { return true; }
    return this.memorySemaphore.getAvailablePermits() >= this.getEstimatedMemoryForModel(modelId);
  }

  hasCapacity(): boolean { return this.getAvailableModel() !== null; }

  hasCapacityForModel(modelId: string): boolean {
    return this.getModelLimiter(modelId).hasCapacity() && this.hasMemoryCapacity(modelId);
  }

  getAvailableModel(): string | null {
    return this.order.find((m) => this.hasCapacityForModel(m)) ?? null;
  }

  private getAvailableModelExcluding(excludeModels: ReadonlySet<string>): string | null {
    return this.order.find((m) => !excludeModels.has(m) && this.hasCapacityForModel(m)) ?? null;
  }

  private async waitForAnyModelCapacity(): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    const checkCapacity = (): void => {
      const availableModel = this.getAvailableModel();
      if (availableModel !== null) { resolve(availableModel); return; }
      setTimeout(checkCapacity, DEFAULT_POLL_INTERVAL_MS);
    };
    checkCapacity();
    return await promise;
  }

  private async waitForAnyModelCapacityExcluding(excludeModels: ReadonlySet<string>): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    const checkCapacity = (): void => {
      const availableModel = this.getAvailableModelExcluding(excludeModels);
      if (availableModel !== null) { resolve(availableModel); return; }
      setTimeout(checkCapacity, DEFAULT_POLL_INTERVAL_MS);
    };
    checkCapacity();
    return await promise;
  }

  private async acquireMemory(modelId: string): Promise<void> {
    const mem = this.getEstimatedMemoryForModel(modelId);
    if (this.memorySemaphore !== null && mem > ZERO) { await this.memorySemaphore.acquire(mem); }
  }

  private releaseMemory(modelId: string): void {
    const mem = this.getEstimatedMemoryForModel(modelId);
    if (this.memorySemaphore !== null && mem > ZERO) { this.memorySemaphore.release(mem); }
  }

  async queueJob<T extends LLMJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
    options: QueueJobOptions<T, Args>
  ): Promise<MultiModelJobResult<T>> {
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

  private async executeJobWithDelegation<T extends LLMJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<MultiModelJobResult<T>> {
    const selectedModel = this.getAvailableModelExcluding(ctx.triedModels) ?? await this.waitForAnyModelCapacityExcluding(ctx.triedModels);
    ctx.triedModels.add(selectedModel);
    await this.acquireMemory(selectedModel);
    try {
      return await this.executeJobOnModel(ctx, selectedModel);
    } catch (error) {
      this.releaseMemory(selectedModel);
      if (isDelegationError(error)) { return await this.handleDelegation(ctx); }
      const totalCost = calculateTotalCost(ctx.usage);
      const callbackContext: JobCallbackContext = { jobId: ctx.jobId, totalCost, usage: ctx.usage };
      if (ctx.onError !== undefined) { ctx.onError(error instanceof Error ? error : new Error(String(error)), callbackContext); }
      throw error;
    }
  }

  private async executeJobOnModel<T extends LLMJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>,
    modelId: string
  ): Promise<MultiModelJobResult<T>> {
    const limiter = this.getModelLimiter(modelId);
    let callbackCalled = false;
    let shouldDelegate = false;
    let rejectedWithoutDelegation = false;
    const handleResolve = (usage: UsageEntry): void => {
      callbackCalled = true;
      this.addUsageWithCost(ctx, modelId, usage);
    };
    const handleReject = (usage: UsageEntry, opts?: { delegate?: boolean }): void => {
      callbackCalled = true;
      this.addUsageWithCost(ctx, modelId, usage);
      shouldDelegate = opts?.delegate !== false;
      if (!shouldDelegate) { rejectedWithoutDelegation = true; }
    };
    // Build job args: modelId is injected, user args are merged
    const argsWithModel = buildJobArgs<Args>(modelId, ctx.args);
    const result = await limiter.queueJob(async () => {
      const jobResult = await ctx.job(argsWithModel, handleResolve, handleReject);
      if (!callbackCalled) { throw new Error('Job must call resolve() or reject()'); }
      if (rejectedWithoutDelegation) { throw new Error('Job rejected without delegation'); }
      if (shouldDelegate) { throw new DelegationError(); }
      return jobResult;
    });
    this.releaseMemory(modelId);
    const finalResult = { ...result, modelUsed: modelId };
    const totalCost = calculateTotalCost(ctx.usage);
    const callbackContext: JobCallbackContext = { jobId: ctx.jobId, totalCost, usage: ctx.usage };
    if (ctx.onComplete !== undefined) { ctx.onComplete(finalResult, callbackContext); }
    return finalResult;
  }

  private async handleDelegation<T extends LLMJobResult, Args extends ArgsWithoutModelId>(
    ctx: JobExecutionContext<T, Args>
  ): Promise<MultiModelJobResult<T>> {
    const nextModel = this.getAvailableModelExcluding(ctx.triedModels);
    if (nextModel === null) { ctx.triedModels.clear(); }
    return await this.executeJobWithDelegation(ctx);
  }

  async queueJobForModel<T extends LLMJobResult>(modelId: string, job: () => Promise<T> | T): Promise<T> {
    const limiter = this.getModelLimiter(modelId);
    await this.acquireMemory(modelId);
    try {
      return await limiter.queueJob(job);
    } finally {
      this.releaseMemory(modelId);
    }
  }

  getStats(): MultiModelRateLimiterStats {
    const modelStats: Record<string, LLMRateLimiterStats> = {};
    for (const [modelId, limiter] of this.modelLimiters) { modelStats[modelId] = limiter.getStats(); }
    const stats: MultiModelRateLimiterStats = { models: modelStats };
    if (this.memorySemaphore !== null) {
      const { inUse, max, available } = this.memorySemaphore.getStats();
      stats.memory = { activeKB: inUse, maxCapacityKB: max, availableKB: available, systemAvailableKB: Math.round(getAvailableMemoryKB()) };
    }
    return stats;
  }

  getModelStats(modelId: string): LLMRateLimiterStats {
    return this.getModelLimiter(modelId).getStats();
  }

  stop(): void {
    if (this.memoryRecalculationIntervalId !== null) {
      clearInterval(this.memoryRecalculationIntervalId);
      this.memoryRecalculationIntervalId = null;
    }
    for (const limiter of this.modelLimiters.values()) { limiter.stop(); }
    this.log('Stopped');
  }
}

/** Create a new Multi-Model Rate Limiter. Order is optional for single model, required for multiple. */
export const createMultiModelRateLimiter = <T extends ModelsConfig>(
  config: ValidatedMultiModelConfig<T>
): MultiModelRateLimiterInstance => new MultiModelRateLimiter(config as MultiModelRateLimiterConfig);
