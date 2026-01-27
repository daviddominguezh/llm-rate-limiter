/**
 * Test for memory resize in rateLimiter interval callback.
 * Uses module-level mocking to simulate memory changes.
 */
import { setTimeout as setTimeoutAsync } from 'node:timers/promises';
import { jest } from '@jest/globals';

const ZERO = 0;
const ONE = 1;
const TEN = 10;
const FIFTY = 50;
const THOUSAND = 1000;
const RATIO_HALF = 0.5;

let mockMemoryValue = THOUSAND * TEN;
jest.unstable_mockModule('../utils/memoryUtils.js', () => ({
  getAvailableMemoryKB: jest.fn(() => mockMemoryValue),
  getAvailableMemoryMB: jest.fn(() => mockMemoryValue / THOUSAND),
  getAvailableMemoryBytes: jest.fn(() => mockMemoryValue * THOUSAND),
}));

const { createInternalLimiter } = await import('../rateLimiter.js');

describe('rateLimiter - memory resize on interval', () => {
  it('should resize memory semaphore when available memory changes', async () => {
    mockMemoryValue = THOUSAND * TEN;
    const limiter = createInternalLimiter({
      memory: { freeMemoryRatio: RATIO_HALF, recalculationIntervalMs: TEN },
      resourcesPerEvent: { estimatedUsedMemoryKB: ONE },
    });
    const { memory: initialMem } = limiter.getStats();
    const initialMax = initialMem?.maxCapacityKB ?? ZERO;
    mockMemoryValue = THOUSAND * FIFTY;
    await setTimeoutAsync(TEN + TEN);
    const { memory: newMem } = limiter.getStats();
    const newMax = newMem?.maxCapacityKB ?? ZERO;
    expect(newMax).toBeGreaterThan(initialMax);
    limiter.stop();
  });
});
