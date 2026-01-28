/**
 * Basic fair distribution tests - single and two instance scenarios.
 */
import { assertCapacityInvariant, FairDistributionBackend } from './fairDistribution.helpers.js';
import { completeJobs, createAndStartLimiter, startControllableJobs } from './fairDistribution.testHelpers.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const TEN = 10;
const TWENTY = 20;
const FORTY = 40;
const FIFTY = 50;
const EIGHTY = 80;
const HUNDRED = 100;

const DEFAULT_TIMEOUT = 30_000;

describe('fair distribution - single instance', () => {
  it('single instance receives full capacity', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });
    const limiter = await createAndStartLimiter(backend);

    expect(backend.getInstanceCount()).toBe(ONE);
    expect(backend.getTotalAllocated()).toBe(HUNDRED);
    assertCapacityInvariant(backend);

    limiter.stop();
  }, DEFAULT_TIMEOUT);

  it('single instance can use all capacity', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: TEN, estimatedTokensPerRequest: TEN });
    const limiter = await createAndStartLimiter(backend);

    const jobs = await startControllableJobs(limiter, TEN);

    expect(backend.getTotalInFlight()).toBe(TEN);
    expect(backend.getTotalAllocated()).toBe(ZERO);
    assertCapacityInvariant(backend);

    await completeJobs(jobs);

    expect(backend.getTotalInFlight()).toBe(ZERO);
    expect(backend.getTotalAllocated()).toBe(TEN);
    assertCapacityInvariant(backend);

    limiter.stop();
  }, DEFAULT_TIMEOUT);
});

describe('fair distribution - two instances', () => {
  it('two instances split capacity 50/50', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);

    expect(backend.getInstanceCount()).toBe(TWO);
    expect(backend.getTotalAllocated()).toBe(HUNDRED);

    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsB = backend.getInstanceStats(limiterB.getInstanceId());

    expect(statsA?.allocation).toBe(FIFTY);
    expect(statsB?.allocation).toBe(FIFTY);
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);

  it('late joiner gets remaining capacity while busy instance drains', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: HUNDRED, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const jobsA = await startControllableJobs(limiterA, EIGHTY);

    expect(backend.getInstanceStats(limiterA.getInstanceId())?.inFlight).toBe(EIGHTY);
    expect(backend.getInstanceStats(limiterA.getInstanceId())?.allocation).toBe(TWENTY);
    assertCapacityInvariant(backend);

    const limiterB = await createAndStartLimiter(backend);

    const statsA = backend.getInstanceStats(limiterA.getInstanceId());
    const statsB = backend.getInstanceStats(limiterB.getInstanceId());

    expect(statsA?.allocation).toBe(ZERO);
    expect(statsB?.allocation).toBe(TWENTY);
    assertCapacityInvariant(backend);

    await completeJobs(jobsA.slice(ZERO, FORTY));

    const statsAAfter = backend.getInstanceStats(limiterA.getInstanceId());
    const statsBAfter = backend.getInstanceStats(limiterB.getInstanceId());

    expect(statsAAfter?.inFlight).toBe(FORTY);
    expect(statsAAfter?.allocation).toBe(TEN);
    expect(statsBAfter?.allocation).toBe(FIFTY);
    assertCapacityInvariant(backend);

    await completeJobs(jobsA.slice(FORTY));

    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);
});
