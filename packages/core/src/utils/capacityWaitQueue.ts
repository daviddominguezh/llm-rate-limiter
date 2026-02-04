/**
 * FIFO queue for jobs waiting for capacity with timeout support.
 * Jobs are queued and served in order when capacity becomes available.
 * Generic type T represents the reservation context returned when capacity is acquired.
 */

/** Waiter entry in the queue */
interface QueuedWaiter<T> {
  /** Resolve the promise with context (capacity acquired) or null (timed out) */
  resolve: (result: T | null) => void;
  /** Timeout handle for cleanup */
  timeoutId: NodeJS.Timeout | null;
  /** Whether this waiter has been resolved (to prevent double resolution) */
  resolved: boolean;
}

// Constants
const ZERO = 0;

/**
 * A FIFO queue for jobs waiting for capacity.
 * When capacity becomes available, the first waiter in line gets to try reserving it.
 * Each waiter has an individual timeout after which they are removed from the queue.
 * Generic type T represents the reservation context returned when capacity is acquired.
 */
export class CapacityWaitQueue<T = unknown> {
  private readonly queue: QueuedWaiter<T>[] = [];
  private readonly name: string;

  constructor(name = 'CapacityWaitQueue') {
    this.name = name;
  }

  /**
   * Wait for capacity with a timeout.
   * @param tryReserve Function that attempts to atomically reserve capacity. Returns context if successful, null if not.
   * @param maxWaitMS Maximum time to wait in milliseconds. 0 means no waiting (fail fast).
   * @returns Promise that resolves to reservation context if capacity was reserved, null if timed out.
   */
  async waitForCapacity(tryReserve: () => T | null, maxWaitMS: number): Promise<T | null> {
    // Fail fast: don't wait at all
    if (maxWaitMS === ZERO) {
      return tryReserve();
    }

    // Try to reserve immediately before queuing
    const immediateResult = tryReserve();
    if (immediateResult !== null) {
      return immediateResult;
    }

    // Create waiter entry
    const { promise, resolve } = Promise.withResolvers<T | null>();

    const waiter: QueuedWaiter<T> = {
      resolve: (result: T | null) => {
        if (waiter.resolved) return; // Prevent double resolution
        waiter.resolved = true;
        if (waiter.timeoutId !== null) {
          clearTimeout(waiter.timeoutId);
          waiter.timeoutId = null;
        }
        resolve(result);
      },
      timeoutId: null,
      resolved: false,
    };

    // Set up timeout
    waiter.timeoutId = setTimeout(() => {
      this.removeWaiter(waiter);
      waiter.resolve(null); // Timed out
    }, maxWaitMS);

    // Add to queue (FIFO)
    this.queue.push(waiter);

    return promise;
  }

  /**
   * Notify the queue that capacity may be available.
   * Attempts to serve waiters in FIFO order.
   * @param tryReserve Function that attempts to atomically reserve capacity.
   */
  notifyCapacityAvailable(tryReserve: () => T | null): void {
    this.processQueue(tryReserve);
  }

  /**
   * Process the queue and serve waiters that can acquire capacity.
   */
  private processQueue(tryReserve: () => T | null): void {
    while (this.queue.length > ZERO) {
      const firstWaiter = this.queue[ZERO];
      if (firstWaiter === undefined || firstWaiter.resolved) {
        // Remove stale entry
        this.queue.shift();
        continue;
      }

      // Try to reserve for this waiter
      const result = tryReserve();
      if (result !== null) {
        this.queue.shift();
        firstWaiter.resolve(result); // Capacity acquired with context
      } else {
        // No more capacity available, stop processing
        break;
      }
    }
  }

  /**
   * Remove a waiter from the queue (used when timeout fires).
   */
  private removeWaiter(waiter: QueuedWaiter<T>): void {
    const index = this.queue.indexOf(waiter);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Get the number of waiters in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if there are any waiters in the queue.
   */
  hasWaiters(): boolean {
    return this.queue.length > ZERO;
  }

  /**
   * Clear all waiters from the queue (used during shutdown).
   * All waiters are resolved with null.
   */
  clear(): void {
    while (this.queue.length > ZERO) {
      const waiter = this.queue.shift();
      if (waiter !== undefined && !waiter.resolved) {
        waiter.resolve(null);
      }
    }
  }
}
