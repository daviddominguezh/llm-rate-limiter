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
  JobWindowStarts,
  OverageEvent,
  OverageResourceType,
  ReservationContext,
} from './types.js';
import { CapacityWaitQueue } from './utils/capacityWaitQueue.js';
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
  JobWindowStarts,
  ReservationContext,
  OverageEvent,
  OverageResourceType,
  OverageFn,
} from './types.js';

const ZERO = 0;
const ONE = 1;
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
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
  private readonly capacityWaitQueue: CapacityWaitQueue<ReservationContext>;
  private windowResetTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: InternalLimiterConfig) {
    validateConfig(config);
    this.config = config;
    this.label = config.label ?? DEFAULT_LABEL;

    // Resource estimates for pre-reservation before job execution
    this.estimatedNumberOfRequests = config.estimatedNumberOfRequests ?? ZERO;
    this.estimatedUsedTokens = config.estimatedUsedTokens ?? ZERO;
    this.estimatedUsedMemoryKB = config.estimatedUsedMemoryKB ?? ZERO;

    // Initialize FIFO queue for capacity waiting
    this.capacityWaitQueue = new CapacityWaitQueue(`${this.label}/WaitQueue`);

    this.initializeMemoryLimiter();
    this.initializeConcurrencyLimiter();
    this.initializeTimeWindowCounters();
    this.log('Initialized', {
      estimatedUsedTokens: this.estimatedUsedTokens,
      estimatedNumberOfRequests: this.estimatedNumberOfRequests,
      tokensPerMinute: this.config.tokensPerMinute,
    });
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.onLog !== undefined) {
      this.config.onLog(`${this.label}| ${message}`, data);
    }
  }

  /**
   * Emit an overage event when actual usage exceeds estimated usage.
   * Only emits if onOverage callback is configured and actual > estimated.
   */
  private emitOverageIfNeeded(resourceType: OverageResourceType, estimated: number, actual: number): void {
    if (this.config.onOverage === undefined) return;
    if (actual <= estimated) return;

    const event: OverageEvent = {
      resourceType,
      estimated,
      actual,
      overage: actual - estimated,
      timestamp: Date.now(),
    };

    this.config.onOverage(event);
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
    const { memory } = this.config;
    const freeKB = getAvailableMemoryKB();
    const ratio = memory?.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
    return Math.floor(freeKB * ratio);
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

  /**
   * Wait for time window capacity and reserve it.
   * Returns JobWindowStarts for time-aware refunds at job completion.
   */
  private async waitForTimeWindowCapacity(): Promise<JobWindowStarts> {
    // Debug: log current state
    const tpmStats = this.tpmCounter?.getStats();
    this.log('[DEBUG] waitForTimeWindowCapacity', {
      estimatedUsedTokens: this.estimatedUsedTokens,
      estimatedNumberOfRequests: this.estimatedNumberOfRequests,
      tpmCurrent: tpmStats?.current,
      tpmLimit: tpmStats?.limit,
      tpmRemaining: tpmStats?.remaining,
    });

    // When estimates are 0, don't wait - we'll record actual usage after the job
    // Return current window starts for tracking (even though no capacity was reserved)
    if (this.estimatedNumberOfRequests === ZERO && this.estimatedUsedTokens === ZERO) {
      this.log('Skipping capacity wait - estimates are 0');
      return {
        rpmWindowStart: this.rpmCounter?.getWindowStart(),
        rpdWindowStart: this.rpdCounter?.getWindowStart(),
        tpmWindowStart: this.tpmCounter?.getWindowStart(),
        tpdWindowStart: this.tpdCounter?.getWindowStart(),
      };
    }
    const { promise, resolve } = Promise.withResolvers<JobWindowStarts>();
    let waitCount = 0;
    const checkCapacity = (): void => {
      const windowStarts = this.tryReserveCapacity();
      if (windowStarts !== null) {
        if (waitCount > 0) {
          this.log('Capacity available after waiting', { waitCount });
        }
        resolve(windowStarts);
        return;
      }
      waitCount++;
      if (waitCount === 1) {
        const stats = this.tpmCounter?.getStats();
        this.log('Waiting for capacity', {
          tpmCurrent: stats?.current,
          tpmLimit: stats?.limit,
          tpmRemaining: stats?.remaining,
          estimatedTokens: this.estimatedUsedTokens,
        });
      }
      const waitTime = this.getMinTimeUntilCapacity();
      setTimeout(checkCapacity, Math.min(waitTime, DEFAULT_POLL_INTERVAL_MS));
    };
    checkCapacity();
    return promise;
  }

  /**
   * Atomically check capacity and reserve if available.
   * Returns JobWindowStarts if reservation succeeded, null if no capacity.
   * Captures window starts BEFORE adding to counters for time-aware refunds.
   */
  private tryReserveCapacity(): JobWindowStarts | null {
    if (!this.hasTimeWindowCapacityForEstimates()) {
      return null;
    }

    // Capture window starts BEFORE adding to counters
    const windowStarts: JobWindowStarts = {
      rpmWindowStart: this.rpmCounter?.getWindowStart(),
      rpdWindowStart: this.rpdCounter?.getWindowStart(),
      tpmWindowStart: this.tpmCounter?.getWindowStart(),
      tpdWindowStart: this.tpdCounter?.getWindowStart(),
    };

    // Reserve immediately after checking - this is atomic within single-threaded JS
    if (this.estimatedNumberOfRequests > ZERO) {
      this.rpmCounter?.add(this.estimatedNumberOfRequests);
      this.rpdCounter?.add(this.estimatedNumberOfRequests);
    }
    if (this.estimatedUsedTokens > ZERO) {
      this.tpmCounter?.add(this.estimatedUsedTokens);
      this.tpdCounter?.add(this.estimatedUsedTokens);
    }
    return windowStarts;
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

  /**
   * Get the minimum time until any time window resets.
   * Used to schedule proactive notifications when windows reset.
   */
  private getTimeUntilNextWindowReset(): number {
    const counters = [this.rpmCounter, this.rpdCounter, this.tpmCounter, this.tpdCounter].filter(
      (c): c is TimeWindowCounter => c !== null
    );
    if (counters.length === ZERO) return Infinity;
    const times = counters.map((c) => c.getTimeUntilReset());
    return Math.min(...times);
  }

  /**
   * Schedule a notification at the next window reset boundary.
   * Only schedules if there are waiters in the queue and no timer is already active.
   */
  private scheduleWindowResetNotification(): void {
    // Don't schedule if already scheduled
    if (this.windowResetTimerId !== null) return;

    // Don't schedule if no waiters
    if (!this.capacityWaitQueue.hasWaiters()) return;

    const timeUntilReset = this.getTimeUntilNextWindowReset();
    if (timeUntilReset === Infinity || timeUntilReset <= ZERO) return;

    this.windowResetTimerId = setTimeout(() => {
      this.windowResetTimerId = null;
      this.notifyCapacityAvailable();
    }, timeUntilReset);
  }

  /**
   * Record actual request usage with time-window awareness.
   * - If actual < estimated: refunds unused capacity (only if same time window)
   * - If actual > estimated: adds the overage to counters
   */
  private recordRequestUsage(actualRequests: number, windowStarts: JobWindowStarts): void {
    if (this.estimatedNumberOfRequests === ZERO) {
      // No estimate = no pre-reservation, add actual to current window
      this.rpmCounter?.add(actualRequests);
      this.rpdCounter?.add(actualRequests);
      return;
    }

    const difference = actualRequests - this.estimatedNumberOfRequests;

    if (difference < ZERO) {
      // Actual < estimated: refund the unused capacity (only if same window)
      const refund = -difference;
      if (windowStarts.rpmWindowStart !== undefined) {
        this.rpmCounter?.subtractIfSameWindow(refund, windowStarts.rpmWindowStart);
      }
      if (windowStarts.rpdWindowStart !== undefined) {
        this.rpdCounter?.subtractIfSameWindow(refund, windowStarts.rpdWindowStart);
      }
    } else if (difference > ZERO) {
      // Actual > estimated: add the overage to counters
      this.rpmCounter?.add(difference);
      this.rpdCounter?.add(difference);
    }
    // If difference === 0, nothing to adjust
  }

  /**
   * Record actual token usage with time-window awareness.
   * - If actual < estimated: refunds unused capacity (only if same time window)
   * - If actual > estimated: adds the overage to counters
   */
  private recordTokenUsage(actualTokens: number, windowStarts: JobWindowStarts): void {
    if (this.estimatedUsedTokens === ZERO) {
      // No estimate = no pre-reservation, add actual to current window
      this.tpmCounter?.add(actualTokens);
      this.tpdCounter?.add(actualTokens);
      return;
    }

    const difference = actualTokens - this.estimatedUsedTokens;

    if (difference < ZERO) {
      // Actual < estimated: refund the unused capacity (only if same window)
      const refund = -difference;
      if (windowStarts.tpmWindowStart !== undefined) {
        this.tpmCounter?.subtractIfSameWindow(refund, windowStarts.tpmWindowStart);
      }
      if (windowStarts.tpdWindowStart !== undefined) {
        this.tpdCounter?.subtractIfSameWindow(refund, windowStarts.tpdWindowStart);
      }
    } else if (difference > ZERO) {
      // Actual > estimated: add the overage to counters
      this.tpmCounter?.add(difference);
      this.tpdCounter?.add(difference);
    }
    // If difference === 0, nothing to adjust
  }

  /**
   * Record actual usage with time-window awareness.
   * Only refunds unused capacity if still within the same time window.
   * Emits overage events when actual usage exceeds estimates.
   */
  private recordActualUsage(result: InternalJobResult, windowStarts: JobWindowStarts): void {
    const { requestCount: actualRequests, usage } = result;
    const actualTokens = usage.input + usage.output;

    this.recordRequestUsage(actualRequests, windowStarts);
    this.recordTokenUsage(actualTokens, windowStarts);

    // Track overages when actual exceeds estimated
    this.emitOverageIfNeeded('requests', this.estimatedNumberOfRequests, actualRequests);
    this.emitOverageIfNeeded('tokens', this.estimatedUsedTokens, actualTokens);
  }

  async queueJob<T extends InternalJobResult>(job: () => Promise<T> | T): Promise<T> {
    // Wait for time window capacity - returns window starts for time-aware refunds
    const windowStarts = await this.waitForTimeWindowCapacity();

    // Acquire memory (in KB)
    if (this.memorySemaphore !== null) {
      await this.memorySemaphore.acquire(this.estimatedUsedMemoryKB);
    }

    // Acquire concurrency slot
    if (this.concurrencySemaphore !== null) {
      await this.concurrencySemaphore.acquire();
    }

    try {
      // Resources already reserved in tryReserveCapacity() during waitForTimeWindowCapacity()

      // Execute the job
      const result = await job();

      // Record actual usage with window context (only refunds if same window)
      this.recordActualUsage(result, windowStarts);

      return result;
    } finally {
      // Release concurrency slot
      this.concurrencySemaphore?.release();

      // Release memory (in KB) - no real tracking, just free what was reserved
      if (this.memorySemaphore !== null) {
        this.memorySemaphore.release(this.estimatedUsedMemoryKB);
      }

      // Notify queue that capacity may be available
      this.notifyCapacityAvailable();
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
    if (this.windowResetTimerId !== null) {
      clearTimeout(this.windowResetTimerId);
      this.windowResetTimerId = null;
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

  /**
   * Atomically check and reserve ALL capacity types (time windows, memory, concurrency).
   * Returns ReservationContext if capacity was reserved, null if no capacity available.
   * The context contains window starts for time-aware refunds at release.
   */
  tryReserve(): ReservationContext | null {
    // Check ALL capacity types first (memory, concurrency, time windows)
    if (!this.hasCapacity()) {
      return null;
    }

    // Capture window starts BEFORE adding to counters
    const windowStarts: JobWindowStarts = {
      rpmWindowStart: this.rpmCounter?.getWindowStart(),
      rpdWindowStart: this.rpdCounter?.getWindowStart(),
      tpmWindowStart: this.tpmCounter?.getWindowStart(),
      tpdWindowStart: this.tpdCounter?.getWindowStart(),
    };

    // Reserve time window capacity
    if (this.estimatedNumberOfRequests > ZERO) {
      this.rpmCounter?.add(this.estimatedNumberOfRequests);
      this.rpdCounter?.add(this.estimatedNumberOfRequests);
    }
    if (this.estimatedUsedTokens > ZERO) {
      this.tpmCounter?.add(this.estimatedUsedTokens);
      this.tpdCounter?.add(this.estimatedUsedTokens);
    }

    // Reserve memory capacity (non-blocking)
    if (this.memorySemaphore !== null) {
      const memoryToReserve = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      if (!this.memorySemaphore.tryAcquire(memoryToReserve)) {
        // Rollback time window reservation
        this.releaseTimeWindowReservation(windowStarts);
        return null;
      }
    }

    // Reserve concurrency slot (non-blocking)
    if (this.concurrencySemaphore !== null) {
      if (!this.concurrencySemaphore.tryAcquire()) {
        // Rollback memory and time window reservations
        if (this.memorySemaphore !== null) {
          const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
          this.memorySemaphore.release(memoryToRelease);
        }
        this.releaseTimeWindowReservation(windowStarts);
        return null;
      }
    }

    return { windowStarts };
  }

  /**
   * Release only time window reservations (used for rollback and release).
   * Respects time window boundaries - only refunds if still in same window.
   */
  private releaseTimeWindowReservation(windowStarts: JobWindowStarts): void {
    if (this.estimatedNumberOfRequests > ZERO) {
      if (windowStarts.rpmWindowStart !== undefined) {
        this.rpmCounter?.subtractIfSameWindow(this.estimatedNumberOfRequests, windowStarts.rpmWindowStart);
      }
      if (windowStarts.rpdWindowStart !== undefined) {
        this.rpdCounter?.subtractIfSameWindow(this.estimatedNumberOfRequests, windowStarts.rpdWindowStart);
      }
    }
    if (this.estimatedUsedTokens > ZERO) {
      if (windowStarts.tpmWindowStart !== undefined) {
        this.tpmCounter?.subtractIfSameWindow(this.estimatedUsedTokens, windowStarts.tpmWindowStart);
      }
      if (windowStarts.tpdWindowStart !== undefined) {
        this.tpdCounter?.subtractIfSameWindow(this.estimatedUsedTokens, windowStarts.tpdWindowStart);
      }
    }
  }

  /**
   * Release previously reserved capacity (all types: time windows, memory, concurrency).
   * Used when a job fails before execution after calling tryReserve().
   * Respects time window boundaries - only refunds time-windowed limits if still in same window.
   * @param context The reservation context from tryReserve()
   */
  releaseReservation(context: ReservationContext): void {
    // Release time window reservations (respects window boundaries)
    this.releaseTimeWindowReservation(context.windowStarts);

    // Release memory (not time-windowed - always release)
    if (this.memorySemaphore !== null) {
      const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
      this.memorySemaphore.release(memoryToRelease);
    }

    // Release concurrency slot (not time-windowed - always release)
    this.concurrencySemaphore?.release();

    // Notify queue that capacity may be available
    this.notifyCapacityAvailable();
  }

  /**
   * Wait for capacity using a FIFO queue with timeout.
   * Jobs are served in order when capacity becomes available.
   * @param maxWaitMS Maximum time to wait (0 = fail fast, no waiting)
   * @returns Promise resolving to ReservationContext if capacity was reserved, null if timed out
   */
  waitForCapacityWithTimeout(maxWaitMS: number): Promise<ReservationContext | null> {
    return this.capacityWaitQueue.waitForCapacity(() => this.tryReserve(), maxWaitMS);
  }

  /**
   * Notify the wait queue that capacity may be available.
   * Called after releasing capacity to wake waiting jobs.
   * Also schedules a notification at the next window reset if waiters remain.
   */
  private notifyCapacityAvailable(): void {
    this.capacityWaitQueue.notifyCapacityAvailable(() => this.tryReserve());

    // Schedule notification at next window reset if waiters remain
    this.scheduleWindowResetNotification();
  }

  /**
   * Create an empty window starts object (for cases where we need a context but no reservation happened).
   */
  private createEmptyWindowStarts(): JobWindowStarts {
    return {
      rpmWindowStart: this.rpmCounter?.getWindowStart(),
      rpdWindowStart: this.rpdCounter?.getWindowStart(),
      tpmWindowStart: this.tpmCounter?.getWindowStart(),
      tpdWindowStart: this.tpdCounter?.getWindowStart(),
    };
  }

  /**
   * Queue a job with pre-reserved capacity (all types already reserved via tryReserve()).
   * Skips all capacity acquisition since everything was already reserved atomically.
   * @param job The job function to execute
   * @param context The reservation context from tryReserve() for window-aware refunds
   */
  async queueJobWithReservedCapacity<T extends InternalJobResult>(
    job: () => Promise<T> | T,
    context: ReservationContext
  ): Promise<T> {
    // All capacity (time windows, memory, concurrency) already reserved via tryReserve()
    try {
      // Execute the job
      const result = await job();

      // Record actual usage with window context (only refunds if same window)
      this.recordActualUsage(result, context.windowStarts);

      return result;
    } finally {
      // Release concurrency slot (was reserved in tryReserve - not time-windowed)
      this.concurrencySemaphore?.release();

      // Release memory (was reserved in tryReserve - not time-windowed)
      if (this.memorySemaphore !== null) {
        const memoryToRelease = this.estimatedUsedMemoryKB > ZERO ? this.estimatedUsedMemoryKB : ONE;
        this.memorySemaphore.release(memoryToRelease);
      }

      // Notify queue that capacity may be available
      this.notifyCapacityAvailable();
    }
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
