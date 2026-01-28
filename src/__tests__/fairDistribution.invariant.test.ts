/**
 * Fair distribution capacity invariant tests.
 */
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import { assertCapacityInvariant, FairDistributionBackend } from './fairDistribution.helpers.js';
import { createAndStartLimiter, sleep, startControllableJobs } from './fairDistribution.testHelpers.js';

const ZERO = 0;
const ONE = 1;
const FIVE = 5;
const TEN = 10;
const TWENTY = 20;
const FIFTY = 50;
const DEFAULT_TIMEOUT = 30_000;

/** Helper to create multiple limiters - sequential creation required for test determinism */
const createMultipleLimiters = async (
  backend: FairDistributionBackend,
  count: number
): Promise<LLMRateLimiterInstance[]> => {
  const limiters: LLMRateLimiterInstance[] = [];
  for (let i = ZERO; i < count; i += ONE) {
    // eslint-disable-next-line no-await-in-loop -- Sequential creation required for deterministic test behavior
    const limiter = await createAndStartLimiter(backend);
    limiters.push(limiter);
  }
  return limiters;
};

/** Helper to queue jobs for all limiters */
const queueJobsForAllLimiters = (
  limiters: LLMRateLimiterInstance[],
  jobsPerLimiter: number
): Array<Promise<unknown>> => {
  const allJobPromises: Array<Promise<unknown>> = [];
  for (const limiter of limiters) {
    for (let j = ZERO; j < jobsPerLimiter; j += ONE) {
      const promise = limiter.queueJob({
        jobId: `job-${limiter.getInstanceId()}-${j}`,
        job: async ({ modelId }, resolve) => {
          await sleep(FIVE);
          resolve({ modelId, inputTokens: ZERO, cachedTokens: ZERO, outputTokens: ZERO });
          return { requestCount: ONE, usage: { input: ZERO, output: ZERO, cached: ZERO } };
        },
      }).catch(() => { /* Expected for jobs that get rejected */ });
      allJobPromises.push(promise);
    }
  }
  return allJobPromises;
};

/** Helper to stop all limiters */
const stopAllLimiters = (limiters: LLMRateLimiterInstance[]): void => {
  for (const limiter of limiters) {
    limiter.stop();
  }
};

describe('fair distribution - capacity invariant', () => {
  it('NEVER exceeds capacity under concurrent load', async () => {
    const CAPACITY = FIFTY;
    const NUM_INSTANCES = FIVE;
    const JOBS_PER_INSTANCE = TWENTY;

    const backend = new FairDistributionBackend({ totalCapacity: CAPACITY, estimatedTokensPerRequest: TEN });

    const limiters = await createMultipleLimiters(backend, NUM_INSTANCES);
    const allJobPromises = queueJobsForAllLimiters(limiters, JOBS_PER_INSTANCE);

    assertCapacityInvariant(backend);

    await Promise.allSettled(allJobPromises);

    assertCapacityInvariant(backend);
    stopAllLimiters(limiters);
  }, DEFAULT_TIMEOUT);

  it('maintains invariant through rapid job completion', async () => {
    const backend = new FairDistributionBackend({ totalCapacity: TWENTY, estimatedTokensPerRequest: TEN });

    const limiterA = await createAndStartLimiter(backend);
    const limiterB = await createAndStartLimiter(backend);

    const jobsA = await startControllableJobs(limiterA, TEN);
    assertCapacityInvariant(backend);

    const jobsB = await startControllableJobs(limiterB, TEN);
    assertCapacityInvariant(backend);

    for (let i = ZERO; i < TEN; i += ONE) {
      const { [i]: jobA } = jobsA;
      const { [i]: jobB } = jobsB;
      if (jobA !== undefined) {
        jobA.complete();
      }
      assertCapacityInvariant(backend);
      if (jobB !== undefined) {
        jobB.complete();
      }
      assertCapacityInvariant(backend);
    }

    await Promise.allSettled([...jobsA, ...jobsB].map(async (j) => { await j.promise; }));
    assertCapacityInvariant(backend);

    limiterA.stop();
    limiterB.stop();
  }, DEFAULT_TIMEOUT);
});

describe('fair distribution - capacity invariant assertion', () => {
  it('assertCapacityInvariant throws when capacity is exceeded', () => {
    const backend = new FairDistributionBackend({ totalCapacity: TEN, estimatedTokensPerRequest: TEN });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Testing internal invariant violation
    const instances = Reflect.get(backend, 'instances') as Map<string, { inFlight: number; allocation: number }>;

    instances.set('fake-instance', { inFlight: TWENTY, allocation: ZERO });

    expect(() => { assertCapacityInvariant(backend); }).toThrow('Capacity invariant violated');
  });
});
