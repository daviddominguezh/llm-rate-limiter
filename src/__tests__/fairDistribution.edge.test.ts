/**
 * Fair distribution edge cases and stats inspection tests.
 */
import { assertCapacityInvariant, FairDistributionBackend } from './fairDistribution.helpers.js';
import { createAndStartLimiter, startControllableJobs } from './fairDistribution.testHelpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const TEN = 10;
const TWENTY = 20;
const THIRTY = 30;
const FIFTY = 50;
const HUNDRED = 100;
const DEFAULT_TIMEOUT = 30_000;

describe('fair distribution - edge cases', () => {
  it('handles zero capacity', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: ZERO, estimatedTokensPerRequest: TEN });
    const limiter = await createAndStartLimiter(backend);

    expect(backend.getInstanceStats(limiter.getInstanceId())?.allocation).toBe(ZERO);
    assertCapacityInvariant(backend);

    limiter.stop();
  }, DEFAULT_TIMEOUT);

  it('handles capacity of 1 with multiple instances', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: ONE, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);
    const limiterC = await createAndStartLimiter(backend);

    const total = backend.getTotalAllocated() + backend.getTotalInFlight();
    expect(total).toBeLessThanOrEqual(ONE);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
    limiterC.stop();
  }, DEFAULT_TIMEOUT);

  it('handles non-divisible capacity', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: TEN, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);
    const limiterC = await createAndStartLimiter(backend);

    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsB = backend.getInstanceStats(limiterB.getInstanceId());
    const statsC = backend.getInstanceStats(limiterC.getInstanceId());

    const totalAllocated = (statsA?.allocation ?? ZERO) + (statsB?.allocation ?? ZERO) + (statsC?.allocation ?? ZERO);
    expect(totalAllocated).toBeLessThanOrEqual(TEN);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
    limiterC.stop();
  }, DEFAULT_TIMEOUT);
});

describe('fair distribution - stats inspection', () => {
  it('getStats returns correct aggregate values', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    await startControllableJobs(limiterA, THIRTY);

    const limiterB = await createAndStartLimiter(backend);
    await startControllableJobs(limiterB, TWENTY);

    const stats = backend.getStats();

    expect(stats.instanceCount).toBe(TWO);
    expect(stats.totalInFlight).toBe(FIFTY);
    expect(stats.totalAllocated + stats.totalInFlight).toBeLessThanOrEqual(HUNDRED);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);

  it('getTotalCapacity returns configured capacity', () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });
    expect(backend.getTotalCapacity()).toBe(HUNDRED);
  });

  it('getInstanceStats returns undefined for unknown instance', () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });
    expect(backend.getInstanceStats('unknown-instance')).toBeUndefined();
  });
});
