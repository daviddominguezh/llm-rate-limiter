import { TimeWindowCounter } from '@globalUtils/timeWindowCounter.js';

const WINDOW_MS = 1000;
const LIMIT = 5;
const COUNTER_NAME = 'TestCounter';

describe('TimeWindowCounter', () => {
  let counter: TimeWindowCounter;

  beforeEach(() => {
    counter = new TimeWindowCounter(LIMIT, WINDOW_MS, COUNTER_NAME);
  });

  describe('hasCapacity', () => {
    it('should have capacity when count is below limit', () => {
      expect(counter.hasCapacity()).toBe(true);
    });

    it('should not have capacity when count reaches limit', () => {
      for (let i = 0; i < LIMIT; i++) {
        counter.increment();
      }
      expect(counter.hasCapacity()).toBe(false);
    });

    it('should have capacity after adding tokens below limit', () => {
      const TOKENS_TO_ADD = 3;
      counter.add(TOKENS_TO_ADD);
      expect(counter.hasCapacity()).toBe(true);
    });

    it('should not have capacity after adding tokens at limit', () => {
      counter.add(LIMIT);
      expect(counter.hasCapacity()).toBe(false);
    });
  });

  describe('increment', () => {
    it('should increment count by 1', () => {
      counter.increment();
      const stats = counter.getStats();
      expect(stats.current).toBe(1);
    });

    it('should increment count multiple times', () => {
      const INCREMENT_COUNT = 3;
      for (let i = 0; i < INCREMENT_COUNT; i++) {
        counter.increment();
      }
      const stats = counter.getStats();
      expect(stats.current).toBe(INCREMENT_COUNT);
    });
  });

  describe('add', () => {
    it('should add specified amount to count', () => {
      const AMOUNT = 3;
      counter.add(AMOUNT);
      const stats = counter.getStats();
      expect(stats.current).toBe(AMOUNT);
    });

    it('should accumulate multiple adds', () => {
      const FIRST_ADD = 2;
      const SECOND_ADD = 3;
      counter.add(FIRST_ADD);
      counter.add(SECOND_ADD);
      const stats = counter.getStats();
      expect(stats.current).toBe(FIRST_ADD + SECOND_ADD);
    });
  });

  describe('subtract', () => {
    it('should subtract specified amount from count', () => {
      const INITIAL = 5;
      const SUBTRACT = 2;
      counter.add(INITIAL);
      counter.subtract(SUBTRACT);
      const stats = counter.getStats();
      expect(stats.current).toBe(INITIAL - SUBTRACT);
    });

    it('should not go below zero when subtracting more than current count', () => {
      const INITIAL = 3;
      const SUBTRACT = 10;
      counter.add(INITIAL);
      counter.subtract(SUBTRACT);
      const stats = counter.getStats();
      expect(stats.current).toBe(0);
    });

    it('should handle subtracting from zero count', () => {
      counter.subtract(5);
      const stats = counter.getStats();
      expect(stats.current).toBe(0);
    });

    it('should restore capacity after subtraction', () => {
      counter.add(LIMIT);
      expect(counter.hasCapacity()).toBe(false);
      counter.subtract(2);
      expect(counter.hasCapacity()).toBe(true);
    });

    it('should work correctly after multiple add and subtract operations', () => {
      counter.add(4);
      counter.subtract(2);
      counter.add(3);
      counter.subtract(1);
      const stats = counter.getStats();
      expect(stats.current).toBe(4);
    });
  });

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = counter.getStats();
      expect(stats.current).toBe(0);
      expect(stats.limit).toBe(LIMIT);
      expect(stats.remaining).toBe(LIMIT);
      expect(stats.resetsInMs).toBeGreaterThanOrEqual(0);
      expect(stats.resetsInMs).toBeLessThanOrEqual(WINDOW_MS);
    });

    it('should return correct stats after incrementing', () => {
      const INCREMENT_COUNT = 2;
      for (let i = 0; i < INCREMENT_COUNT; i++) {
        counter.increment();
      }
      const stats = counter.getStats();
      expect(stats.current).toBe(INCREMENT_COUNT);
      expect(stats.remaining).toBe(LIMIT - INCREMENT_COUNT);
    });

    it('should return 0 remaining when at limit', () => {
      counter.add(LIMIT);
      const stats = counter.getStats();
      expect(stats.remaining).toBe(0);
    });
  });

  describe('getTimeUntilReset', () => {
    it('should return time until window reset', () => {
      const timeUntilReset = counter.getTimeUntilReset();
      expect(timeUntilReset).toBeGreaterThanOrEqual(0);
      expect(timeUntilReset).toBeLessThanOrEqual(WINDOW_MS);
    });
  });

  describe('window reset', () => {
    it('should reset count after window expires', async () => {
      const SHORT_WINDOW_MS = 50;
      const shortCounter = new TimeWindowCounter(LIMIT, SHORT_WINDOW_MS, COUNTER_NAME);

      shortCounter.add(LIMIT);
      expect(shortCounter.hasCapacity()).toBe(false);

      // Wait for window to reset
      await new Promise((resolve) => {
        setTimeout(resolve, SHORT_WINDOW_MS + 10);
      });

      expect(shortCounter.hasCapacity()).toBe(true);
      const stats = shortCounter.getStats();
      expect(stats.current).toBe(0);
    });
  });

  describe('logging', () => {
    it('should call onLog when window resets', async () => {
      const SHORT_WINDOW_MS = 50;
      const logMessages: string[] = [];
      const onLog = (message: string): void => {
        logMessages.push(message);
      };

      const loggedCounter = new TimeWindowCounter(LIMIT, SHORT_WINDOW_MS, COUNTER_NAME, onLog);
      loggedCounter.increment();

      await new Promise((resolve) => {
        setTimeout(resolve, SHORT_WINDOW_MS + 10);
      });

      // Trigger window check
      loggedCounter.hasCapacity();

      expect(logMessages.some((msg) => msg.includes('Window reset'))).toBe(true);
    });
  });
});
