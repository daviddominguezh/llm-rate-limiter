/**
 * Internal LLM Rate Limiter class implementation.
 */
import type {
  InternalJobResult,
  InternalLimiterConfig,
  InternalLimiterInstance,
  InternalLimiterStats,
  JobWindowStarts,
  RateLimitUpdate,
  ReservationContext,
} from '../types.js';
import { CapacityWaitQueue } from './capacityWaitQueue.js';
import { validateConfig } from './configValidation.js';
import { isDelegationError } from './jobExecutionHelpers.js';
import {
  type CapacityEstimates,
  type CountersSet,
  captureWindowStarts,
  getMinTimeUntilCapacity,
  getTimeUntilNextWindowReset,
  hasTimeWindowCapacity,
  hasTimeWindowCapacityForAmounts,
  releaseTimeWindowReservation,
  reserveTimeWindowCapacity,
} from './rateLimiterCapacityHelpers.js';
import { buildLimiterStats, createDelegationResult } from './rateLimiterInitHelpers.js';
import {
  createConcurrencyLimiter,
  createMemoryLimiter,
  createTimeWindowCounters,
} from './rateLimiterInternalInit.js';
import { recordActualUsage } from './rateLimiterUsageHelpers.js';
import type { Semaphore } from './semaphore.js';
import type { TimeWindowCounter } from './timeWindowCounter.js';

const ZERO = 0;
const ONE = 1;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_LABEL = 'LLMRateLimiter';

export class LLMRateLimiterInternal implements InternalLimiterInstance {
  private readonly config: InternalLimiterConfig;
  private readonly label: string;
  private readonly estimates: CapacityEstimates;
  private readonly estimatedUsedMemoryKB: number;
  private memorySemaphore: Semaphore | null = null;
  private memoryRecalculationIntervalId: NodeJS.Timeout | null = null;
  private concurrencySemaphore: Semaphore | null = null;
  private rpmCounter: TimeWindowCounter | null = null;
  private rpdCounter: TimeWindowCounter | null = null;
  private tpmCounter: TimeWindowCounter | null = null;
  private tpdCounter: TimeWindowCounter | null = null;
  private readonly capacityWaitQueue: CapacityWaitQueue<ReservationContext>;
  private windowResetTimerId: ReturnType<typeof setTimeout> | null = null;
  constructor(config: InternalLimiterConfig) {
    validateConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;
    this.estimates = {
      estimatedNumberOfRequests: config.estimatedNumberOfRequests ?? ZERO,
      estimatedUsedTokens: config.estimatedUsedTokens ?? ZERO,
    };
    this.estimatedUsedMemoryKB = config.estimatedUsedMemoryKB ?? ZERO;
    this.capacityWaitQueue = new CapacityWaitQueue(`${this.label}/WaitQueue`);
    this.initializeLimiters();
    this.log('Initialized', {
      estimatedUsedTokens: this.estimates.estimatedUsedTokens,
      estimatedNumberOfRequests: this.estimates.estimatedNumberOfRequests,
      tokensPerMinute: this.config.tokensPerMinute,
    });
  }
  private log(message: string, data?: Record<string, unknown>): void {
    this.config.onLog?.(`${this.label}| ${message}`, data);
  }
  private get counters(): CountersSet {
    return {
      rpmCounter: this.rpmCounter,
      rpdCounter: this.rpdCounter,
      tpmCounter: this.tpmCounter,
      tpdCounter: this.tpdCounter,
    };
  }
  private initializeLimiters(): void {
    if (this.config.memory !== undefined) {
      const { semaphore, intervalId } = createMemoryLimiter(this.config.memory, this.label);
      this.memorySemaphore = semaphore;
      this.memoryRecalculationIntervalId = intervalId;
    }
    this.concurrencySemaphore = createConcurrencyLimiter(this.config.maxConcurrentRequests, this.label);
    const { rpmCounter, rpdCounter, tpmCounter, tpdCounter } = createTimeWindowCounters(
      this.config,
      this.label
    );
    this.rpmCounter = rpmCounter;
    this.rpdCounter = rpdCounter;
    this.tpmCounter = tpmCounter;
    this.tpdCounter = tpdCounter;
  }
  private async waitForTimeWindowCapacity(): Promise<JobWindowStarts> {
    const { estimates } = this;
    const { estimatedNumberOfRequests, estimatedUsedTokens } = estimates;
    if (estimatedNumberOfRequests === ZERO && estimatedUsedTokens === ZERO) {
      this.log('Skipping capacity wait - estimates are 0');
      return captureWindowStarts(this.counters);
    }
    const { promise, resolve } = Promise.withResolvers<JobWindowStarts>();
    let waitCount = ZERO;
    const checkCapacity = (): void => {
      const windowStarts = this.tryReserveCapacityInternal();
      if (windowStarts !== null) {
        if (waitCount > ZERO) {
          this.log('Capacity available after waiting', { waitCount });
        }
        resolve(windowStarts);
        return;
      }
      waitCount += ONE;
      if (waitCount === ONE) {
        const stats = this.tpmCounter?.getStats();
        this.log('Waiting for capacity', {
          tpmCurrent: stats?.current,
          tpmLimit: stats?.limit,
          tpmRemaining: stats?.remaining,
          estimatedTokens: estimatedUsedTokens,
        });
      }
      const waitTime = getMinTimeUntilCapacity(this.counters);
      setTimeout(checkCapacity, Math.min(waitTime, DEFAULT_POLL_INTERVAL_MS));
    };
    checkCapacity();
    return await promise;
  }
  private tryReserveCapacityInternal(): JobWindowStarts | null {
    const { estimates } = this;
    const { estimatedNumberOfRequests, estimatedUsedTokens } = estimates;
    if (!hasTimeWindowCapacityForAmounts(this.counters, estimatedNumberOfRequests, estimatedUsedTokens)) {
      return null;
    }
    const windowStarts = captureWindowStarts(this.counters);
    reserveTimeWindowCapacity(this.counters, this.estimates);
    return windowStarts;
  }
  hasCapacity(): boolean {
    if (this.memorySemaphore !== null) {
      const memoryNeeded = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      if (!this.memorySemaphore.hasCapacityFor(memoryNeeded)) return false;
    }
    if (this.concurrencySemaphore !== null && !this.concurrencySemaphore.hasCapacity()) return false;
    return hasTimeWindowCapacity(this.counters);
  }
  tryReserve(): ReservationContext | null {
    if (!this.hasCapacity()) return null;
    const windowStarts = captureWindowStarts(this.counters);
    reserveTimeWindowCapacity(this.counters, this.estimates);
    if (this.memorySemaphore !== null) {
      const memoryToReserve = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      if (!this.memorySemaphore.tryAcquire(memoryToReserve)) {
        releaseTimeWindowReservation(this.counters, this.estimates, windowStarts);
        return null;
      }
    }
    if (this.concurrencySemaphore !== null && !this.concurrencySemaphore.tryAcquire()) {
      if (this.memorySemaphore !== null) {
        const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
        this.memorySemaphore.release(memoryToRelease);
      }
      releaseTimeWindowReservation(this.counters, this.estimates, windowStarts);
      return null;
    }
    return { windowStarts };
  }
  releaseReservation(context: ReservationContext): void {
    releaseTimeWindowReservation(this.counters, this.estimates, context.windowStarts);
    if (this.memorySemaphore !== null) {
      const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      this.memorySemaphore.release(memoryToRelease);
    }
    this.concurrencySemaphore?.release();
    this.notifyCapacityAvailable();
  }
  async waitForCapacityWithTimeout(maxWaitMS: number): Promise<ReservationContext | null> {
    return await this.capacityWaitQueue.waitForCapacity(() => this.tryReserve(), maxWaitMS);
  }
  async waitForCapacityWithCustomReserve(
    customTryReserve: () => ReservationContext | null,
    maxWaitMS: number
  ): Promise<ReservationContext | null> {
    return await this.capacityWaitQueue.waitForCapacity(customTryReserve, maxWaitMS);
  }
  notifyExternalCapacityChange(): void {
    this.capacityWaitQueue.notifyCapacityAvailable();
  }
  private notifyCapacityAvailable(): void {
    this.capacityWaitQueue.notifyCapacityAvailable();
    this.scheduleWindowResetNotification();
  }
  private scheduleWindowResetNotification(): void {
    if (this.windowResetTimerId !== null) return;
    if (!this.capacityWaitQueue.hasWaiters()) return;
    const timeUntilReset = getTimeUntilNextWindowReset(this.counters);
    if (timeUntilReset === Infinity || timeUntilReset <= ZERO) return;
    this.windowResetTimerId = setTimeout(() => {
      this.windowResetTimerId = null;
      this.notifyCapacityAvailable();
    }, timeUntilReset);
  }
  async queueJob<T extends InternalJobResult>(job: () => Promise<T> | T): Promise<T> {
    const windowStarts = await this.waitForTimeWindowCapacity();
    if (this.memorySemaphore !== null) {
      await this.memorySemaphore.acquire(this.estimatedUsedMemoryKB);
    }
    if (this.concurrencySemaphore !== null) {
      await this.concurrencySemaphore.acquire();
    }
    try {
      const result = await job();
      this.recordUsage(result, windowStarts);
      return result;
    } catch (error) {
      this.handleDelegationError(error, windowStarts);
      throw error;
    } finally {
      this.releaseResources();
    }
  }
  async queueJobWithReservedCapacity<T extends InternalJobResult>(
    job: () => Promise<T> | T,
    context: ReservationContext
  ): Promise<T> {
    try {
      const result = await job();
      this.recordUsage(result, context.windowStarts);
      return result;
    } catch (error) {
      this.handleDelegationError(error, context.windowStarts);
      throw error;
    } finally {
      this.releaseResources();
    }
  }
  private handleDelegationError(error: unknown, windowStarts: JobWindowStarts): void {
    if (isDelegationError(error)) {
      this.recordUsage(createDelegationResult(error.usage), windowStarts);
    }
  }
  private releaseResources(): void {
    this.concurrencySemaphore?.release();
    if (this.memorySemaphore !== null) {
      const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      this.memorySemaphore.release(memoryToRelease);
    }
    this.notifyCapacityAvailable();
  }
  private recordUsage(result: InternalJobResult, windowStarts: JobWindowStarts): void {
    recordActualUsage(result, {
      counters: this.counters,
      estimates: this.estimates,
      windowStarts,
      onOverage: this.config.onOverage,
    });
  }
  setRateLimits(update: RateLimitUpdate): void {
    this.updateCounterLimit(this.tpmCounter, update.tokensPerMinute, 'TPM');
    this.updateCounterLimit(this.rpmCounter, update.requestsPerMinute, 'RPM');
    this.updateCounterLimit(this.tpdCounter, update.tokensPerDay, 'TPD');
    this.updateCounterLimit(this.rpdCounter, update.requestsPerDay, 'RPD');
  }
  private updateCounterLimit(
    counter: TimeWindowCounter | null,
    newLimit: number | undefined,
    name: string
  ): void {
    if (newLimit !== undefined && counter !== null) {
      counter.setLimit(newLimit);
      this.log(`Updated ${name} limit`, { newLimit });
    }
  }
  getStats(): InternalLimiterStats {
    return buildLimiterStats(this.memorySemaphore, this.concurrencySemaphore, this.counters);
  }
  stop(): void {
    if (this.memoryRecalculationIntervalId !== null) {
      clearInterval(this.memoryRecalculationIntervalId);
      this.memoryRecalculationIntervalId = null;
    }
    if (this.windowResetTimerId !== null) {
      clearTimeout(this.windowResetTimerId);
      this.windowResetTimerId = null;
    }
    this.capacityWaitQueue.cancelAll();
  }
}
