/**
 * LLM Rate Limiter - supports memory, RPM, RPD, TPM, TPD, and concurrent request limits.
 * All limits are optional - only defined limits are enforced.
 *
 * Features:
 * - Pre-reserves estimated resources before job execution
 * - Tracks actual usage after job execution and refunds the difference
 * - Strict compile-time type safety for resourcesPerEvent requirements
 */
import { validateConfig } from '@globalUtils/configValidation.js';
import { getAvailableMemoryKB } from '@globalUtils/memoryUtils.js';
import { Semaphore } from '@globalUtils/semaphore.js';
import { TimeWindowCounter } from '@globalUtils/timeWindowCounter.js';

import type {
  LLMJobResult,
  LLMRateLimiterConfig,
  LLMRateLimiterConfigBase,
  LLMRateLimiterInstance,
  LLMRateLimiterStats,
  ValidatedConfig,
} from './types.js';

export type {
  TokenUsage,
  LLMJobResult,
  MemoryLimitConfig,
  LLMRateLimiterConfig,
  LLMRateLimiterConfigBase,
  LLMRateLimiterStats,
  LLMRateLimiterInstance,
  BaseResourcesPerEvent,
  ValidatedConfig,
} from './types.js';

const ZERO = 0;
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const DEFAULT_LABEL = 'LLMRateLimiter';

class LLMRateLimiter implements LLMRateLimiterInstance {
  private readonly config: LLMRateLimiterConfig;
  private readonly label: string;
  private readonly estimatedNumberOfRequests: number;
  private readonly estimatedUsedTokens: number;
  private readonly estimatedUsedMemoryKB: number;
  private memorySemaphore: Semaphore | null = null;
  private memoryRecalculationIntervalId: NodeJS.Timeout | null = null;
  private concurrencySemaphore: Semaphore | null = null;
  private rpmCounter: TimeWindowCounter | null = null;
  private rpdCounter: TimeWindowCounter | null = null;
  private tpmCounter: TimeWindowCounter | null = null;
  private tpdCounter: TimeWindowCounter | null = null;

  constructor(config: LLMRateLimiterConfig) {
    validateConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;

    // Extract estimated resources (with defaults of 0 if not configured)
    const resources = config.resourcesPerEvent ?? {};
    this.estimatedNumberOfRequests = resources.estimatedNumberOfRequests ?? ZERO;
    this.estimatedUsedTokens = resources.estimatedUsedTokens ?? ZERO;
    this.estimatedUsedMemoryKB = resources.estimatedUsedMemoryKB ?? ZERO;

    this.initializeMemoryLimiter();
    this.initializeConcurrencyLimiter();
    this.initializeTimeWindowCounters();
    this.log('Initialized');
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) {
      this.config.onLog(`${this.label}| ${message}`, data);
    }
  }

  private initializeMemoryLimiter(): void {
    if (this.config.memory === undefined) {
      return;
    }
    const initialCapacity = this.calculateMemoryCapacityKB();
    this.memorySemaphore = new Semaphore(initialCapacity, `${this.label}/Memory`, this.config.onLog);
    const intervalMs = this.config.memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
    this.memoryRecalculationIntervalId = setInterval(() => {
      if (this.memorySemaphore === null) {
        return;
      }
      const { max: currentMax } = this.memorySemaphore.getStats();
      const newCapacity = this.calculateMemoryCapacityKB();
      if (newCapacity !== currentMax) {
        this.memorySemaphore.resize(newCapacity);
      }
    }, intervalMs);
  }

  private calculateMemoryCapacityKB(): number {
    if (this.config.memory === undefined) {
      return ZERO;
    }
    const freeKB = getAvailableMemoryKB();
    const ratio = this.config.memory.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
    const calculated = Math.floor(freeKB * ratio);

    // Apply minCapacity and maxCapacity from main config
    let clamped = Math.max(this.config.minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
    if (this.config.maxCapacity !== undefined) {
      clamped = Math.min(clamped, this.config.maxCapacity);
    }
    return clamped;
  }

  private initializeConcurrencyLimiter(): void {
    if (this.config.maxConcurrentRequests === undefined) {
      return;
    }
    this.concurrencySemaphore = new Semaphore(
      this.config.maxConcurrentRequests,
      `${this.label}/Concurrency`,
      this.config.onLog
    );
  }

  private createCounter(limit: number | undefined, windowMs: number, suffix: string): TimeWindowCounter | null {
    if (limit === undefined) return null;
    return new TimeWindowCounter(limit, windowMs, `${this.label}/${suffix}`, this.config.onLog);
  }

  private initializeTimeWindowCounters(): void {
    this.rpmCounter = this.createCounter(this.config.requestsPerMinute, MS_PER_MINUTE, 'RPM');
    this.rpdCounter = this.createCounter(this.config.requestsPerDay, MS_PER_DAY, 'RPD');
    this.tpmCounter = this.createCounter(this.config.tokensPerMinute, MS_PER_MINUTE, 'TPM');
    this.tpdCounter = this.createCounter(this.config.tokensPerDay, MS_PER_DAY, 'TPD');
  }

  private async waitForTimeWindowCapacity(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<undefined>();
    const checkCapacity = (): void => {
      if (this.hasTimeWindowCapacity()) {
        resolve(undefined);
        return;
      }
      const waitTime = this.getMinTimeUntilCapacity();
      setTimeout(checkCapacity, Math.min(waitTime, DEFAULT_POLL_INTERVAL_MS));
    };
    checkCapacity();
    await promise;
  }

  private hasTimeWindowCapacity(): boolean {
    const requestCounters = [this.rpmCounter, this.rpdCounter].filter((c) => c !== null);
    const tokenCounters = [this.tpmCounter, this.tpdCounter].filter((c) => c !== null);
    const hasRequestCapacity = requestCounters.every((c) => c.hasCapacityFor(this.estimatedNumberOfRequests));
    const hasTokenCapacity = tokenCounters.every((c) => c.hasCapacityFor(this.estimatedUsedTokens));
    return hasRequestCapacity && hasTokenCapacity;
  }

  private getMinTimeUntilCapacity(): number {
    const requestCounters = [this.rpmCounter, this.rpdCounter].filter((c) => c !== null);
    const tokenCounters = [this.tpmCounter, this.tpdCounter].filter((c) => c !== null);
    const times = [
      ...requestCounters.filter((c) => !c.hasCapacityFor(this.estimatedNumberOfRequests)).map((c) => c.getTimeUntilReset()),
      ...tokenCounters.filter((c) => !c.hasCapacityFor(this.estimatedUsedTokens)).map((c) => c.getTimeUntilReset()),
    ];
    return times.length > ZERO ? Math.min(...times) : ZERO;
  }

  private reserveResources(): void {
    // Reserve estimated resources BEFORE job execution
    this.rpmCounter?.add(this.estimatedNumberOfRequests);
    this.rpdCounter?.add(this.estimatedNumberOfRequests);
    this.tpmCounter?.add(this.estimatedUsedTokens);
    this.tpdCounter?.add(this.estimatedUsedTokens);
  }

  private refundDifference(result: LLMJobResult): void {
    // Calculate actual usage
    const { requestCount: actualRequests, usage } = result;
    const actualTokens = usage.input + usage.output;

    // Refund the difference between estimated and actual
    const requestRefund = Math.max(ZERO, this.estimatedNumberOfRequests - actualRequests);
    const tokenRefund = Math.max(ZERO, this.estimatedUsedTokens - actualTokens);

    if (requestRefund > ZERO) {
      this.rpmCounter?.subtract(requestRefund);
      this.rpdCounter?.subtract(requestRefund);
    }

    if (tokenRefund > ZERO) {
      this.tpmCounter?.subtract(tokenRefund);
      this.tpdCounter?.subtract(tokenRefund);
    }
  }

  async queueJob<T extends LLMJobResult>(job: () => Promise<T> | T): Promise<T> {
    // Wait for time window capacity
    await this.waitForTimeWindowCapacity();

    // Acquire memory (in KB)
    if (this.memorySemaphore !== null) {
      await this.memorySemaphore.acquire(this.estimatedUsedMemoryKB);
    }

    // Acquire concurrency slot
    if (this.concurrencySemaphore !== null) {
      await this.concurrencySemaphore.acquire();
    }

    try {
      // Reserve estimated resources before job execution
      this.reserveResources();

      // Execute the job
      const result = await job();

      // Refund the difference between estimated and actual usage
      this.refundDifference(result);

      return result;
    } finally {
      // Release concurrency slot
      this.concurrencySemaphore?.release();

      // Release memory (in KB) - no real tracking, just free what was reserved
      if (this.memorySemaphore !== null) {
        this.memorySemaphore.release(this.estimatedUsedMemoryKB);
      }
    }
  }

  stop(): void {
    if (this.memoryRecalculationIntervalId !== null) {
      clearInterval(this.memoryRecalculationIntervalId);
      this.memoryRecalculationIntervalId = null;
    }
    this.log('Stopped');
  }

  hasCapacity(): boolean {
    // Check memory capacity (in KB)
    if (this.memorySemaphore !== null && this.memorySemaphore.getAvailablePermits() < this.estimatedUsedMemoryKB) {
      return false;
    }
    // Check concurrency capacity
    if (this.concurrencySemaphore !== null && this.concurrencySemaphore.getAvailablePermits() <= ZERO) {
      return false;
    }
    return this.hasTimeWindowCapacity();
  }

  getStats(): LLMRateLimiterStats {
    const stats: LLMRateLimiterStats = {};
    if (this.memorySemaphore !== null) {
      const { inUse, max, available } = this.memorySemaphore.getStats();
      stats.memory = { activeKB: inUse, maxCapacityKB: max, availableKB: available, systemAvailableKB: Math.round(getAvailableMemoryKB()) };
    }
    if (this.concurrencySemaphore !== null) {
      const { inUse, max, available, waiting } = this.concurrencySemaphore.getStats();
      stats.concurrency = { active: inUse, limit: max, available, waiting };
    }
    if (this.rpmCounter !== null) stats.requestsPerMinute = this.rpmCounter.getStats();
    if (this.rpdCounter !== null) stats.requestsPerDay = this.rpdCounter.getStats();
    if (this.tpmCounter !== null) stats.tokensPerMinute = this.tpmCounter.getStats();
    if (this.tpdCounter !== null) stats.tokensPerDay = this.tpdCounter.getStats();
    return stats;
  }
}

/**
 * Create a new LLM Rate Limiter instance.
 *
 * The type system enforces that resourcesPerEvent contains the required fields
 * based on which limits are configured:
 * - If requestsPerMinute or requestsPerDay is set, estimatedNumberOfRequests is required
 * - If tokensPerMinute or tokensPerDay is set, estimatedUsedTokens is required
 * - If memory is set, estimatedUsedMemoryKB is required
 */
export const createLLMRateLimiter = <T extends LLMRateLimiterConfigBase>(
  config: ValidatedConfig<T>
): LLMRateLimiterInstance => new LLMRateLimiter(config as LLMRateLimiterConfig);
