/**
 * Fair distribution algorithm verification tests.
 */
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { assertCapacityInvariant, FairDistributionBackend, type InstanceStats } from './fairDistribution.helpers.js';
import { completeJobs, createAndStartLimiter, sleep, startControllableJobs } from './fairDistribution.testHelpers.js';

const ZERO = 0;
const TWO = 2;
const THREE = 3;
const EIGHT = 8;
const TEN = 10;
const ELEVEN = 11;
const TWENTY = 20;
const THIRTY = 30;
const FORTY_FIVE = 45;
const FIFTY = 50;
const SEVENTY = 70;
const EIGHTY = 80;
const NINETY = 90;
const HUNDRED = 100;
const DEFAULT_TIMEOUT = 30_000;

/** Calculate total usage from instance stats */
const calculateTotalFromStats = (stats: Array<InstanceStats | undefined>): number => {
  let total = ZERO;
  for (const s of stats) {
    if (s !== undefined) {
      total += s.inFlight + s.allocation;
    }
  }
  return total;
};

describe('fair distribution - three instances', () => {
  it('three instances split capacity evenly', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: NINETY, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);
    const limiterC = await createAndStartLimiter(backend);

    expect(backend.getInstanceCount()).toBe(THREE);

    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsB = backend.getInstanceStats(limiterB.getInstanceId());
    const statsC = backend.getInstanceStats(limiterC.getInstanceId());

    expect(statsA?.allocation).toBe(THIRTY);
    expect(statsB?.allocation).toBe(THIRTY);
    expect(statsC?.allocation).toBe(THIRTY);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
    limiterC.stop();
  }, DEFAULT_TIMEOUT);

  it('when instance leaves, others absorb its allocation', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: NINETY, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);
    const limiterC = await createAndStartLimiter(backend);

    expect(backend.getInstanceStats(limiterA.getInstanceId())?.allocation).toBe(THIRTY);

    limiterB.stop();
    await sleep(TEN);

    expect(backend.getInstanceCount()).toBe(TWO);

    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsC = backend.getInstanceStats(limiterC.getInstanceId());

    expect(statsA?.allocation).toBe(FORTY_FIVE);
    expect(statsC?.allocation).toBe(FORTY_FIVE);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterC.stop();
  }, DEFAULT_TIMEOUT);
});

/** Helper to setup and verify allocation algorithm test */
interface AllocationTestSetup {
  backend: FairDistributionBackend;
  limiters: LLMRateLimiterInstance[];
}

const setupAllocationAlgorithmTest = async (): Promise<AllocationTestSetup> => {
  const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });
  const limiterA = await createAndStartLimiter(backend);
  await startControllableJobs(limiterA, SEVENTY);
  const limiterB = await createAndStartLimiter(backend);
  await startControllableJobs(limiterB, TEN);
  const limiterC = await createAndStartLimiter(backend);
  return { backend, limiters: [limiterA, limiterB, limiterC] };
};

const verifyAllocationAlgorithm = (setup: AllocationTestSetup): void => {
  const { backend, limiters } = setup;
  const [limiterA, limiterB, limiterC] = limiters;
  if (limiterA === undefined || limiterB === undefined || limiterC === undefined) {
    throw new Error('Limiters not properly initialized');
  }

  const statsA = backend.getInstanceStats(limiterA.getInstanceId());
  const statsB = backend.getInstanceStats(limiterB.getInstanceId());
  const statsC = backend.getInstanceStats(limiterC.getInstanceId());

  expect(statsA?.allocation).toBe(ZERO);
  expect(statsB?.allocation).toBe(EIGHT);
  expect(statsC?.allocation).toBe(ELEVEN);

  const total = calculateTotalFromStats([statsA, statsB, statsC]);
  expect(total).toBeLessThanOrEqual(HUNDRED);
  assertCapacityInvariant(backend);
};

const cleanupLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  for (const limiter of limiters) {
    limiter.stop();
  }
};

describe('fair distribution - algorithm exact', () => {
  it('allocations exactly match fair distribution algorithm', async () => {
    const setup = await setupAllocationAlgorithmTest();
    verifyAllocationAlgorithm(setup);
    cleanupLimiters(setup.limiters);
  }, DEFAULT_TIMEOUT);
});

describe('fair distribution - saturation', () => {
  it('handles uneven distribution when some instances are saturated', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });
    const limiterA = await createAndStartLimiter(backend);
    const jobsA = await startControllableJobs(limiterA, EIGHTY);
    await sleep(FIFTY);

    const statsABefore = backend.getInstanceStats(limiterA.getInstanceId());
    expect(statsABefore?.inFlight).toBe(EIGHTY);
    expect(statsABefore?.allocation).toBe(TWENTY);

    const limiterB = await createAndStartLimiter(backend);
    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsB = backend.getInstanceStats(limiterB.getInstanceId());

    expect(statsA?.inFlight).toBe(EIGHTY);
    expect(statsA?.allocation).toBe(ZERO);
    expect(statsB?.inFlight).toBe(ZERO);
    expect(statsB?.allocation).toBe(TWENTY);
    assertCapacityInvariant(backend);

    await completeJobs(jobsA);
    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);
});
