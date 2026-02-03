/**
 * LLM Rate Limiter - supports memory, RPM, RPD, TPM, TPD, and concurrent request limits.
 * All limits are optional - only defined limits are enforced.
 *
 * Features:
 * - Pre-reserves estimated resources before job execution
 * - Tracks actual usage after job execution and refunds the difference
 * - Strict compile-time type safety for resourcesPerEvent requirements
 */
import type {
  InternalJobResult,
  InternalLimiterConfig,
  InternalLimiterInstance,
  InternalLimiterStats,
} from './types.js';
import { validateConfig } from './utils/configValidation.js';
import { getAvailableMemoryKB } from './utils/memoryUtils.js';
import { Semaphore } from './utils/semaphore.js';
import { TimeWindowCounter } from './utils/timeWindowCounter.js';

export type {
  TokenUsage,
  InternalJobResult,
  MemoryLimitConfig,
  InternalLimiterConfig,
  InternalLimiterStats,
  InternalLimiterInstance,
  BaseResourcesPerEvent,
} from './types.js';

const ZERO = 0;
const ONE = 1;
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_MIN_CAPACITY = 0;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const DEFAULT_LABEL = 'LLMRateLimiter';

class LLMRateLimiter implements InternalLimiterInstance {
  private readonly config: InternalLimiterConfig;
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

  constructor(config: InternalLimiterConfig) {
    validateConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;

    // Resource estimates for pre-reservation before job execution
    this.estimatedNumberOfRequests = config.estimatedNumberOfRequests ?? ZERO;
    this.estimatedUsedTokens = config.estimatedUsedTokens ?? ZERO;
    this.estimatedUsedMemoryKB = config.estimatedUsedMemoryKB ?? ZERO;

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
    const semaphore = new Semaphore(initialCapacity, `${this.label}/Memory`, this.config.onLog);
    this.memorySemaphore = semaphore;
    const intervalMs = this.config.memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
    this.memoryRecalculationIntervalId = setInterval(() => {
      // Use captured reference - semaphore is guaranteed to exist in this closure
      const { max: currentMax } = semaphore.getStats();
      const newCapacity = this.calculateMemoryCapacityKB();
      if (newCapacity !== currentMax) {
        semaphore.resize(newCapacity);
      }
    }, intervalMs);
  }

  private calculateMemoryCapacityKB(): number {
    // This method is only called when memory config exists (from initializeMemoryLimiter)
    const { config } = this;
    const { memory, minCapacity, maxCapacity } = config;
    const freeKB = getAvailableMemoryKB();
    const ratio = memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
    const calculated = Math.floor(freeKB * ratio);

    // Apply minCapacity and maxCapacity from main config
    let clamped = Math.max(minCapacity ?? DEFAULT_MIN_CAPACITY, calculated);
    if (maxCapacity !== undefined) {
      clamped = Math.min(clamped, maxCapacity);
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

  private createCounter(
    limit: number | undefined,
    windowMs: number,
    suffix: string
  ): TimeWindowCounter | null {
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
    // When estimates are 0, don't wait - we'll record actual usage after the job
    if (this.estimatedNumberOfRequests === ZERO && this.estimatedUsedTokens === ZERO) {
      return;
    }
    const { promise, resolve } = Promise.withResolvers<undefined>();
    const checkCapacity = (): void => {
      if (this.hasTimeWindowCapacityForEstimates()) {
        resolve(undefined);
        return;
      }
      const waitTime = this.getMinTimeUntilCapacity();
      setTimeout(checkCapacity, Math.min(waitTime, DEFAULT_POLL_INTERVAL_MS));
    };
    checkCapacity();
    await promise;
  }

  /** Check capacity for actual estimates (used when waiting) */
  private hasTimeWindowCapacityForEstimates(): boolean {
    const requestCounters = [this.rpmCounter, this.rpdCounter].filter((c) => c !== null);
    const tokenCounters = [this.tpmCounter, this.tpdCounter].filter((c) => c !== null);
    const hasRequestCapacity = requestCounters.every((c) => c.hasCapacityFor(this.estimatedNumberOfRequests));
    const hasTokenCapacity = tokenCounters.every((c) => c.hasCapacityFor(this.estimatedUsedTokens));
    return hasRequestCapacity && hasTokenCapacity;
  }

  private hasTimeWindowCapacity(): boolean {
    const requestCounters = [this.rpmCounter, this.rpdCounter].filter((c) => c !== null);
    const tokenCounters = [this.tpmCounter, this.tpdCounter].filter((c) => c !== null);
    // When estimates are 0, check for at least 1 unit of capacity
    const requestsToCheck = this.estimatedNumberOfRequests > ZERO ? this.estimatedNumberOfRequests : ONE;
    const tokensToCheck = this.estimatedUsedTokens > ZERO ? this.estimatedUsedTokens : ONE;
    const hasRequestCapacity = requestCounters.every((c) => c.hasCapacityFor(requestsToCheck));
    const hasTokenCapacity = tokenCounters.every((c) => c.hasCapacityFor(tokensToCheck));
    return hasRequestCapacity && hasTokenCapacity;
  }

  private getMinTimeUntilCapacity(): number {
    // This method is only called when waiting for capacity with estimates > 0
    const requestCounters = [this.rpmCounter, this.rpdCounter].filter((c) => c !== null);
    const tokenCounters = [this.tpmCounter, this.tpdCounter].filter((c) => c !== null);
    const times = [
      ...requestCounters
        .filter((c) => !c.hasCapacityFor(this.estimatedNumberOfRequests))
        .map((c) => c.getTimeUntilReset()),
      ...tokenCounters
        .filter((c) => !c.hasCapacityFor(this.estimatedUsedTokens))
        .map((c) => c.getTimeUntilReset()),
    ];
    return Math.min(...times);
  }

  private recordRequestUsage(actualRequests: number): void {
    if (this.estimatedNumberOfRequests === ZERO) {
      this.rpmCounter?.add(actualRequests);
      this.rpdCounter?.add(actualRequests);
      return;
    }
    const refund = Math.max(ZERO, this.estimatedNumberOfRequests - actualRequests);
    if (refund > ZERO) {
      this.rpmCounter?.subtract(refund);
      this.rpdCounter?.subtract(refund);
    }
  }

  private recordTokenUsage(actualTokens: number): void {
    if (this.estimatedUsedTokens === ZERO) {
      this.tpmCounter?.add(actualTokens);
      this.tpdCounter?.add(actualTokens);
      return;
    }
    const refund = Math.max(ZERO, this.estimatedUsedTokens - actualTokens);
    if (refund > ZERO) {
      this.tpmCounter?.subtract(refund);
      this.tpdCounter?.subtract(refund);
    }
  }

  private recordActualUsage(result: InternalJobResult): void {
    const { requestCount: actualRequests, usage } = result;
    this.recordRequestUsage(actualRequests);
    this.recordTokenUsage(usage.input + usage.output);
  }

  private reserveResources(): void {
    // Reserve estimated resources BEFORE job execution (only if estimates are provided)
    if (this.estimatedNumberOfRequests > ZERO) {
      this.rpmCounter?.add(this.estimatedNumberOfRequests);
      this.rpdCounter?.add(this.estimatedNumberOfRequests);
    }
    if (this.estimatedUsedTokens > ZERO) {
      this.tpmCounter?.add(this.estimatedUsedTokens);
      this.tpdCounter?.add(this.estimatedUsedTokens);
    }
  }

  async queueJob<T extends InternalJobResult>(job: () => Promise<T> | T): Promise<T> {
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

      // Record actual usage (or refund difference if estimates were provided)
      this.recordActualUsage(result);

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

  setRateLimits(update: { tokensPerMinute?: number; requestsPerMinute?: number }): void {
    if (update.tokensPerMinute !== undefined && this.tpmCounter !== null) {
      this.tpmCounter.setLimit(update.tokensPerMinute);
      this.log('Updated TPM limit', { newLimit: update.tokensPerMinute });
    }
    if (update.requestsPerMinute !== undefined && this.rpmCounter !== null) {
      this.rpmCounter.setLimit(update.requestsPerMinute);
      this.log('Updated RPM limit', { newLimit: update.requestsPerMinute });
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
    // Check memory capacity (in KB) - when estimate is 0, check for at least 1 KB
    const memoryToCheck = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
    if (this.memorySemaphore !== null && this.memorySemaphore.getAvailablePermits() < memoryToCheck) {
      return false;
    }
    // Check concurrency capacity
    if (this.concurrencySemaphore !== null && this.concurrencySemaphore.getAvailablePermits() <= ZERO) {
      return false;
    }
    return this.hasTimeWindowCapacity();
  }

  getStats(): InternalLimiterStats {
    const stats: InternalLimiterStats = {};
    if (this.memorySemaphore !== null) {
      const { inUse, max, available } = this.memorySemaphore.getStats();
      stats.memory = {
        activeKB: inUse,
        maxCapacityKB: max,
        availableKB: available,
        systemAvailableKB: Math.round(getAvailableMemoryKB()),
      };
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
 * Create a new internal LLM Rate Limiter instance.
 * This is used internally by the multi-model rate limiter.
 *
 * Resource estimates (tokens, requests, memory) are defined at the job type level
 * via resourcesPerJob in the multi-model limiter configuration.
 */
export const createInternalLimiter = (config: InternalLimiterConfig): InternalLimiterInstance =>
  new LLMRateLimiter(config);
