/**
 * Fair distribution instance lifecycle tests.
 */
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { assertCapacityInvariant, FairDistributionBackend } from './fairDistribution.helpers.js';
import { createAndStartLimiter, sleep, startControllableJobs } from './fairDistribution.testHelpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const THREE = 3;
const TEN = 10;
const THIRTY = 30;
const THIRTY_THREE = 33;
const FIFTY = 50;
const SIXTY = 60;
const HUNDRED = 100;
const DEFAULT_TIMEOUT = 30_000;
const JOIN_PROBABILITY = 0.6;

/** Handle a single iteration of the rapid join/leave test */
const handleRapidChurnIteration = async (
  backend: FairDistributionBackend,
  activeLimiters: LLMRateLimiterInstance[]
): Promise<void> => {
  const shouldJoin = Math.random() < JOIN_PROBABILITY || activeLimiters.length === ZERO;

  if (shouldJoin) {
    const limiter = await createAndStartLimiter(backend);
    activeLimiters.push(limiter);
    await startControllableJobs(limiter, THREE);
    return;
  }

  const idx = Math.floor(Math.random() * activeLimiters.length);
  const { [idx]: limiterToStop } = activeLimiters;
  if (limiterToStop !== undefined) {
    limiterToStop.stop();
    activeLimiters.splice(idx, ONE);
  }
};

describe('fair distribution - instance lifecycle', () => {
  it('handles rapid instance join/leave without violating capacity', async () => {
    const CAPACITY = SIXTY;
    const ITERATIONS = THIRTY;

    const backend = new FairDistributionBackend({ totalCapacity: CAPACITY, estimatedTokensPerRequest: TEN });
    const activeLimiters: LLMRateLimiterInstance[] = [];

    for (let i = ZERO; i < ITERATIONS; i += ONE) {
      // eslint-disable-next-line no-await-in-loop -- Sequential iteration required for lifecycle testing
      await handleRapidChurnIteration(backend, activeLimiters);
      assertCapacityInvariant(backend);
    }

    for (const limiter of activeLimiters) {
      limiter.stop();
    }
  }, DEFAULT_TIMEOUT);

  it('handles all instances leaving and rejoining', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });

    const limiterA1 = await createAndStartLimiter(backend);
    const limiterB1 = await createAndStartLimiter(backend);

    expect(backend.getInstanceCount()).toBe(TWO);
    assertCapacityInvariant(backend);

    limiterA1.stop();
    limiterB1.stop();
    await sleep(TEN);

    expect(backend.getInstanceCount()).toBe(ZERO);

    const limiterA2 = await createAndStartLimiter(backend);
    const limiterB2 = await createAndStartLimiter(backend);
    const limiterC2 = await createAndStartLimiter(backend);

    expect(backend.getInstanceCount()).toBe(THREE);
    expect(backend.getInstanceStats(limiterA2.getInstanceId())?.allocation).toBe(THIRTY_THREE);
    assertCapacityInvariant(backend);

    limiterA2.stop();
    limiterB2.stop();
    limiterC2.stop();
  }, DEFAULT_TIMEOUT);
});

describe('fair distribution - availability callback', () => {
  it('emits allocation updates when slots change', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });

    const slotsHistory: number[] = [];
    const onSlotsChange = (slots: number): void => { slotsHistory.push(slots); };
    const limiterA = await createAndStartLimiter(backend, onSlotsChange);

    expect(slotsHistory.length).toBeGreaterThan(ZERO);
    const { [slotsHistory.length - ONE]: lastSlotA } = slotsHistory;
    expect(lastSlotA).toBe(HUNDRED);

    const limiterB = await createAndStartLimiter(backend);
    await sleep(TEN);

    const { [slotsHistory.length - ONE]: lastSlotAfterB } = slotsHistory;
    expect(lastSlotAfterB).toBe(FIFTY);

    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);
});
