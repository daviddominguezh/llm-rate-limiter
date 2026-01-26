import { Semaphore } from '@globalUtils/semaphore.js';

const INITIAL_PERMITS = 3;
const SEMAPHORE_NAME = 'TestSemaphore';

describe('Semaphore', () => {
  let semaphore: Semaphore;

  beforeEach(() => {
    semaphore = new Semaphore(INITIAL_PERMITS, SEMAPHORE_NAME);
  });

  describe('acquire and release', () => {
    it('should acquire permit when available', async () => {
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS - 1);
    });

    it('should release permit back to pool', async () => {
      await semaphore.acquire();
      semaphore.release();
      expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
    });

    it('should acquire multiple permits', async () => {
      await semaphore.acquire();
      await semaphore.acquire();
      await semaphore.acquire();
      expect(semaphore.getAvailablePermits()).toBe(0);
    });

    it('should queue when no permits available', async () => {
      // Acquire all permits
      for (let i = 0; i < INITIAL_PERMITS; i++) {
        await semaphore.acquire();
      }

      expect(semaphore.getAvailablePermits()).toBe(0);

      // Start acquiring another permit (will queue)
      let acquired = false;
      const acquirePromise = semaphore.acquire().then(() => {
        acquired = true;
      });

      // Verify it's queued
      expect(semaphore.getQueueLength()).toBe(1);
      expect(acquired).toBe(false);

      // Release one permit
      semaphore.release();

      await acquirePromise;
      expect(acquired).toBe(true);
      expect(semaphore.getQueueLength()).toBe(0);
    });

    it('should maintain FIFO order for queued requests', async () => {
      const order: number[] = [];

      // Acquire all permits
      for (let i = 0; i < INITIAL_PERMITS; i++) {
        await semaphore.acquire();
      }

      // Queue multiple requests
      const FIRST_REQUEST = 1;
      const SECOND_REQUEST = 2;
      const THIRD_REQUEST = 3;

      const promise1 = semaphore.acquire().then(() => {
        order.push(FIRST_REQUEST);
      });
      const promise2 = semaphore.acquire().then(() => {
        order.push(SECOND_REQUEST);
      });
      const promise3 = semaphore.acquire().then(() => {
        order.push(THIRD_REQUEST);
      });

      expect(semaphore.getQueueLength()).toBe(3);

      // Release permits one by one
      semaphore.release();
      await promise1;
      semaphore.release();
      await promise2;
      semaphore.release();
      await promise3;

      expect(order).toEqual([FIRST_REQUEST, SECOND_REQUEST, THIRD_REQUEST]);
    });
  });

  describe('variable permits', () => {
    it('should acquire multiple permits at once', async () => {
      const PERMITS_TO_ACQUIRE = 2;
      await semaphore.acquire(PERMITS_TO_ACQUIRE);
      expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS - PERMITS_TO_ACQUIRE);
    });

    it('should release multiple permits at once', async () => {
      const PERMITS_TO_ACQUIRE = 2;
      await semaphore.acquire(PERMITS_TO_ACQUIRE);
      semaphore.release(PERMITS_TO_ACQUIRE);
      expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
    });

    it('should queue when not enough permits available', async () => {
      const LARGE_PERMITS = 5;
      let acquired = false;

      const acquirePromise = semaphore.acquire(LARGE_PERMITS).then(() => {
        acquired = true;
      });

      expect(semaphore.getQueueLength()).toBe(1);
      expect(acquired).toBe(false);

      // Release enough permits to satisfy the request
      semaphore.release(2); // Now have 5 total
      await acquirePromise;

      expect(acquired).toBe(true);
      expect(semaphore.getAvailablePermits()).toBe(0);
    });

    it('should maintain FIFO order with variable permits', async () => {
      const order: number[] = [];

      // Acquire all permits
      await semaphore.acquire(INITIAL_PERMITS);

      // Queue requests with different permit counts
      const promise1 = semaphore.acquire(2).then(() => {
        order.push(1);
      });
      const promise2 = semaphore.acquire(1).then(() => {
        order.push(2);
      });

      expect(semaphore.getQueueLength()).toBe(2);

      // Release 2 permits - first waiter needs 2
      semaphore.release(2);
      await promise1;

      // Release 1 more - second waiter needs 1
      semaphore.release(1);
      await promise2;

      expect(order).toEqual([1, 2]);
    });

    it('should not skip queue even if later waiter could be satisfied', async () => {
      // This tests FIFO fairness - a smaller request behind a larger one must wait

      // Acquire all permits
      await semaphore.acquire(INITIAL_PERMITS);

      let firstAcquired = false;
      let secondAcquired = false;

      // First waiter needs 3 permits
      const promise1 = semaphore.acquire(3).then(() => {
        firstAcquired = true;
      });

      // Second waiter only needs 1 permit
      const promise2 = semaphore.acquire(1).then(() => {
        secondAcquired = true;
      });

      // Release 1 permit - not enough for first waiter
      semaphore.release(1);

      // Give time for any async processing
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      // Neither should be acquired yet (FIFO: first needs 3)
      expect(firstAcquired).toBe(false);
      expect(secondAcquired).toBe(false);
      expect(semaphore.getAvailablePermits()).toBe(1);

      // Release 2 more - now first waiter can proceed
      semaphore.release(2);
      await promise1;
      expect(firstAcquired).toBe(true);

      // Now second waiter needs 1 permit but pool is empty
      expect(semaphore.getAvailablePermits()).toBe(0);

      // Release 1 for second waiter
      semaphore.release(1);
      await promise2;
      expect(secondAcquired).toBe(true);
    });

    it('should handle acquiring more permits than max', async () => {
      // Edge case: request more than initial capacity
      const LARGE_PERMITS = 10;
      let acquired = false;

      const acquirePromise = semaphore.acquire(LARGE_PERMITS).then(() => {
        acquired = true;
      });

      expect(semaphore.getQueueLength()).toBe(1);

      // Release many permits via resize
      semaphore.resize(15);

      await acquirePromise;
      expect(acquired).toBe(true);
    });

    it('should handle mixed single and variable permit operations', async () => {
      // Mix of acquire(1) and acquire(n)
      await semaphore.acquire(2);
      await semaphore.acquire(); // default 1
      expect(semaphore.getAvailablePermits()).toBe(0);

      semaphore.release(); // default 1
      expect(semaphore.getAvailablePermits()).toBe(1);

      semaphore.release(2);
      expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = semaphore.getStats();
      expect(stats.available).toBe(INITIAL_PERMITS);
      expect(stats.max).toBe(INITIAL_PERMITS);
      expect(stats.waiting).toBe(0);
      expect(stats.inUse).toBe(0);
    });

    it('should return correct stats after acquiring', async () => {
      const ACQUIRED_COUNT = 2;
      for (let i = 0; i < ACQUIRED_COUNT; i++) {
        await semaphore.acquire();
      }

      const stats = semaphore.getStats();
      expect(stats.available).toBe(INITIAL_PERMITS - ACQUIRED_COUNT);
      expect(stats.inUse).toBe(ACQUIRED_COUNT);
    });

    it('should track waiting count', async () => {
      // Acquire all permits
      for (let i = 0; i < INITIAL_PERMITS; i++) {
        await semaphore.acquire();
      }

      // Queue a request
      void semaphore.acquire();

      const stats = semaphore.getStats();
      expect(stats.waiting).toBe(1);
    });
  });

  describe('resize', () => {
    it('should increase capacity and add permits', () => {
      const NEW_MAX = 5;
      semaphore.resize(NEW_MAX);

      const stats = semaphore.getStats();
      expect(stats.max).toBe(NEW_MAX);
      expect(stats.available).toBe(NEW_MAX);
    });

    it('should decrease capacity and reduce available permits', async () => {
      const NEW_MAX = 1;
      semaphore.resize(NEW_MAX);

      const stats = semaphore.getStats();
      expect(stats.max).toBe(NEW_MAX);
      expect(stats.available).toBe(NEW_MAX);
    });

    it('should not reduce available below zero when decreasing', async () => {
      // Acquire all permits
      for (let i = 0; i < INITIAL_PERMITS; i++) {
        await semaphore.acquire();
      }

      const NEW_MAX = 1;
      semaphore.resize(NEW_MAX);

      const stats = semaphore.getStats();
      expect(stats.max).toBe(NEW_MAX);
      expect(stats.available).toBe(0);
    });

    it('should wake queued waiters when increasing capacity', async () => {
      // Acquire all permits
      for (let i = 0; i < INITIAL_PERMITS; i++) {
        await semaphore.acquire();
      }

      // Queue requests
      let acquired1 = false;
      let acquired2 = false;
      void semaphore.acquire().then(() => {
        acquired1 = true;
      });
      void semaphore.acquire().then(() => {
        acquired2 = true;
      });

      expect(semaphore.getQueueLength()).toBe(2);

      // Increase capacity
      const NEW_MAX = 5;
      semaphore.resize(NEW_MAX);

      // Allow promises to resolve
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
      expect(semaphore.getQueueLength()).toBe(0);
    });

    it('should not resize below 1 permit', () => {
      semaphore.resize(0);
      expect(semaphore.getStats().max).toBe(1);

      semaphore.resize(-5);
      expect(semaphore.getStats().max).toBe(1);
    });
  });

  describe('logging', () => {
    it('should call onLog when initialized', () => {
      const logMessages: string[] = [];
      const onLog = (message: string): void => {
        logMessages.push(message);
      };

      new Semaphore(INITIAL_PERMITS, SEMAPHORE_NAME, onLog);

      expect(logMessages.some((msg) => msg.includes('Initialized'))).toBe(true);
    });

    it('should call onLog when resized', () => {
      const logMessages: string[] = [];
      const onLog = (message: string): void => {
        logMessages.push(message);
      };

      const loggedSemaphore = new Semaphore(INITIAL_PERMITS, SEMAPHORE_NAME, onLog);
      const NEW_MAX = 5;
      loggedSemaphore.resize(NEW_MAX);

      expect(logMessages.some((msg) => msg.includes('Resized'))).toBe(true);
    });
  });
});
