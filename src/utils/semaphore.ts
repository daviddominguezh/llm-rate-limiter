/**
 * Semaphore implementation for controlling concurrent access to resources.
 * Supports variable permit acquisition for KB-based memory limiting.
 */

/** Logging callback type for semaphore events */
export type SemaphoreLogger = (message: string, data?: Record<string, unknown>) => void;

/** Waiter in the queue with requested permits */
interface QueuedWaiter {
  permits: number;
  resolve: () => void;
}

// Constants
const ZERO_PERMITS = 0;
const ONE_PERMIT = 1;

/**
 * A counting semaphore that limits concurrent access to a resource.
 * Supports variable permit counts for KB-based memory limiting.
 * Waiters are queued and released in FIFO order.
 */
export class Semaphore {
  private permits: number;
  private maxPermits: number;
  private readonly queue: QueuedWaiter[] = [];
  private readonly name: string;
  private readonly onLog?: SemaphoreLogger;

  constructor(permits: number, name = 'Semaphore', onLog?: SemaphoreLogger) {
    this.permits = permits;
    this.maxPermits = permits;
    this.name = name;
    this.onLog = onLog;

    this.log(`Initialized with ${permits} permits`);
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.onLog !== undefined) {
      this.onLog(`${this.name}| ${message}`, data);
    }
  }

  /**
   * Process the queue and wake waiters that can be satisfied.
   * Maintains FIFO order - only the first waiter is checked.
   */
  private processQueue(): void {
    let nextWaiter = this.peekFirstWaiter();
    while (nextWaiter !== undefined && this.permits >= nextWaiter.permits) {
      this.queue.shift();
      this.permits -= nextWaiter.permits;
      nextWaiter.resolve();
      nextWaiter = this.peekFirstWaiter();
    }
  }

  private peekFirstWaiter(): QueuedWaiter | undefined {
    return this.queue[ZERO_PERMITS];
  }

  /**
   * Acquire permits. If not enough permits are available, wait until they are released.
   * @param permits Number of permits to acquire (default: 1)
   */
  async acquire(permits = ONE_PERMIT): Promise<void> {
    if (this.permits >= permits && this.queue.length === ZERO_PERMITS) {
      this.permits -= permits;
      return;
    }

    // Not enough permits available or queue not empty, wait in queue
    const { promise, resolve } = Promise.withResolvers<undefined>();
    this.queue.push({ permits, resolve: () => { resolve(undefined); } });
    // Check if we can be served immediately (in case of concurrent releases)
    this.processQueue();
    await promise;
  }

  /**
   * Release permits back to the pool. Wakes queued waiters if possible.
   * @param permits Number of permits to release (default: 1)
   */
  release(permits = ONE_PERMIT): void {
    this.permits += permits;
    this.processQueue();
  }

  /**
   * Get current number of available permits.
   */
  getAvailablePermits(): number {
    return this.permits;
  }

  /**
   * Get number of waiters in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get stats about the semaphore.
   */
  getStats(): { available: number; max: number; waiting: number; inUse: number } {
    return {
      available: this.permits,
      max: this.maxPermits,
      waiting: this.queue.length,
      inUse: this.maxPermits - this.permits,
    };
  }

  /**
   * Resize the semaphore to a new maximum number of permits.
   *
   * - If increasing: adds permits to the pool and wakes queued waiters
   * - If decreasing: reduces available permits (cannot go negative, won't revoke in-use permits)
   */
  resize(newMax: number): void {
    const safeNewMax = Math.max(ONE_PERMIT, newMax);
    const { maxPermits: oldMax } = this;
    const diff = safeNewMax - oldMax;

    if (diff === ZERO_PERMITS) {
      return;
    }

    if (safeNewMax !== newMax) {
      this.log(`Cannot resize to less than ${ONE_PERMIT} permit, using ${ONE_PERMIT}`);
    }

    this.maxPermits = safeNewMax;

    if (diff > ZERO_PERMITS) {
      // Increasing - add permits and process queue
      this.permits += diff;
      this.processQueue();
    } else {
      // Decreasing permits - reduce available pool (can't go negative)
      this.permits = Math.max(ZERO_PERMITS, this.permits + diff);
    }

    this.log(`Resized from ${oldMax} to ${safeNewMax} permits`, {
      availableAfter: this.permits,
      queueLength: this.queue.length,
    });
  }
}
