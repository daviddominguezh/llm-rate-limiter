import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { Semaphore } from '@globalUtils/semaphore.js';

const INITIAL_PERMITS = 3;
const SEMAPHORE_NAME = 'TestSemaphore';
const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const TEN = 10;
const FIFTEEN = 15;
const DELAY_MS = 10;
const NEGATIVE_FIVE = -5;

const createSemaphore = (): Semaphore => new Semaphore(INITIAL_PERMITS, SEMAPHORE_NAME);

const acquireMultiple = async (semaphore: Semaphore, count: number): Promise<void> => {
  const promises: Array<Promise<void>> = [];
  for (let i = ZERO; i < count; i += ONE) {
    promises.push(semaphore.acquire());
  }
  await Promise.all(promises);
};

describe('Semaphore - acquire and release', () => {
  it('should acquire and release permit', async () => {
    const semaphore = createSemaphore();
    await semaphore.acquire();
    expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS - ONE);
    semaphore.release();
    expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
  });

  it('should acquire all permits', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    expect(semaphore.getAvailablePermits()).toBe(ZERO);
  });
});

describe('Semaphore - queueing', () => {
  it('should queue when no permits available', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    let acquired = false;
    const acquirePromise = semaphore.acquire().then(() => {
      acquired = true;
    });
    expect(semaphore.getQueueLength()).toBe(ONE);
    expect(acquired).toBe(false);
    semaphore.release();
    await acquirePromise;
    expect(acquired).toBe(true);
  });

  it('should maintain FIFO order', async () => {
    const semaphore = createSemaphore();
    const order: number[] = [];
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    const p1 = semaphore.acquire().then(() => {
      order.push(ONE);
    });
    const p2 = semaphore.acquire().then(() => {
      order.push(TWO);
    });
    const p3 = semaphore.acquire().then(() => {
      order.push(THREE);
    });
    semaphore.release();
    await p1;
    semaphore.release();
    await p2;
    semaphore.release();
    await p3;
    expect(order).toEqual([ONE, TWO, THREE]);
  });
});

describe('Semaphore - variable permits basic', () => {
  it('should acquire and release multiple permits', async () => {
    const semaphore = createSemaphore();
    await semaphore.acquire(TWO);
    expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS - TWO);
    semaphore.release(TWO);
    expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
  });

  it('should queue when not enough permits', async () => {
    const semaphore = createSemaphore();
    let acquired = false;
    const acquirePromise = semaphore.acquire(FIVE).then(() => {
      acquired = true;
    });
    expect(semaphore.getQueueLength()).toBe(ONE);
    semaphore.release(TWO);
    await acquirePromise;
    expect(acquired).toBe(true);
  });

  it('should handle mixed operations', async () => {
    const semaphore = createSemaphore();
    await semaphore.acquire(TWO);
    await semaphore.acquire();
    expect(semaphore.getAvailablePermits()).toBe(ZERO);
    semaphore.release();
    semaphore.release(TWO);
    expect(semaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
  });
});

describe('Semaphore - variable permits ordering', () => {
  it('should maintain FIFO order with variable permits', async () => {
    const semaphore = createSemaphore();
    const order: number[] = [];
    await semaphore.acquire(INITIAL_PERMITS);
    const p1 = semaphore.acquire(TWO).then(() => { order.push(ONE); });
    const p2 = semaphore.acquire(ONE).then(() => { order.push(TWO); });
    semaphore.release(TWO);
    await p1;
    semaphore.release(ONE);
    await p2;
    expect(order).toEqual([ONE, TWO]);
  });

  it('should not skip queue for smaller requests', async () => {
    const semaphore = createSemaphore();
    await semaphore.acquire(INITIAL_PERMITS);
    let first = false;
    let second = false;
    const p1 = semaphore.acquire(THREE).then(() => { first = true; });
    const p2 = semaphore.acquire(ONE).then(() => { second = true; });
    semaphore.release(ONE);
    await setTimeoutAsync(DELAY_MS);
    expect(first).toBe(false);
    expect(second).toBe(false);
    semaphore.release(TWO);
    await p1;
    semaphore.release(ONE);
    await p2;
    expect(first).toBe(true);
    expect(second).toBe(true);
  });

  it('should handle resize to satisfy large request', async () => {
    const semaphore = createSemaphore();
    let acquired = false;
    const acquirePromise = semaphore.acquire(TEN).then(() => { acquired = true; });
    semaphore.resize(FIFTEEN);
    await acquirePromise;
    expect(acquired).toBe(true);
  });
});

describe('Semaphore - getStats', () => {
  it('should return correct initial stats', () => {
    const semaphore = createSemaphore();
    const stats = semaphore.getStats();
    expect(stats.available).toBe(INITIAL_PERMITS);
    expect(stats.max).toBe(INITIAL_PERMITS);
    expect(stats.waiting).toBe(ZERO);
    expect(stats.inUse).toBe(ZERO);
  });

  it('should return correct stats after acquiring', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, TWO);
    const stats = semaphore.getStats();
    expect(stats.available).toBe(INITIAL_PERMITS - TWO);
    expect(stats.inUse).toBe(TWO);
  });

  it('should track waiting count', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    void semaphore.acquire();
    expect(semaphore.getStats().waiting).toBe(ONE);
  });
});

describe('Semaphore - resize', () => {
  it('should increase capacity', () => {
    const semaphore = createSemaphore();
    semaphore.resize(FIVE);
    expect(semaphore.getStats().max).toBe(FIVE);
    expect(semaphore.getStats().available).toBe(FIVE);
  });

  it('should wake queued waiters on increase', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    let a1 = false;
    let a2 = false;
    void semaphore.acquire().then(() => { a1 = true; });
    void semaphore.acquire().then(() => { a2 = true; });
    semaphore.resize(FIVE);
    await setTimeoutAsync(ZERO);
    expect(a1).toBe(true);
    expect(a2).toBe(true);
  });

  it('should decrease capacity', () => {
    const semaphore = createSemaphore();
    semaphore.resize(ONE);
    expect(semaphore.getStats().max).toBe(ONE);
  });

  it('should not reduce available below zero', async () => {
    const semaphore = createSemaphore();
    await acquireMultiple(semaphore, INITIAL_PERMITS);
    semaphore.resize(ONE);
    expect(semaphore.getStats().available).toBe(ZERO);
  });

  it('should not resize below 1', () => {
    const semaphore = createSemaphore();
    semaphore.resize(ZERO);
    expect(semaphore.getStats().max).toBe(ONE);
    semaphore.resize(NEGATIVE_FIVE);
    expect(semaphore.getStats().max).toBe(ONE);
  });
});

describe('Semaphore - logging', () => {
  it('should call onLog when initialized and resized', () => {
    const logMessages: string[] = [];
    const onLog = (message: string): void => {
      logMessages.push(message);
    };
    const testSemaphore = new Semaphore(INITIAL_PERMITS, SEMAPHORE_NAME, onLog);
    expect(testSemaphore.getAvailablePermits()).toBe(INITIAL_PERMITS);
    expect(logMessages.some((msg) => msg.includes('Initialized'))).toBe(true);
    testSemaphore.resize(FIVE);
    expect(logMessages.some((msg) => msg.includes('Resized'))).toBe(true);
  });
});
