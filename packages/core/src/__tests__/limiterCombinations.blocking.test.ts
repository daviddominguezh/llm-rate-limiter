import type { UsageEntry } from '../multiModelTypes.js';
import {
  DEFAULT_JOB_TYPE,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  JOB_DELAY_MS,
  LONG_JOB_DELAY_MS,
  MEMORY_MAX_CAPACITY_KB,
  NINE,
  ONE,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  SHORT_JOB_DELAY_MS,
  TIMEOUT_MS,
  TOLERANCE_MS,
  TWO,
  ZERO,
  ZERO_PRICING,
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  setTimeoutAsync,
} from './limiterCombinations.helpers.js';
import type { LLMRateLimiterInstance, MockJobResult } from './limiterCombinations.helpers.js';

interface TrackedJob {
  jobId: string;
  job: (args: { modelId: string }, resolve: (u: UsageEntry) => void) => Promise<MockJobResult>;
}

describe('Blocking - concurrency actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should queue jobs beyond concurrency limit and execute them in order', async () => {
    const MAX_CONCURRENT = 2;
    limiter = createLLMRateLimiter({
      models: { default: { maxConcurrentRequests: MAX_CONCURRENT, pricing: ZERO_PRICING } },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE } },
    });
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};
    const start = Date.now();
    const createTrackedJob = (id: string, delayMs: number): TrackedJob => ({
      jobId: generateJobId(),
      job: async ({ modelId }, resolve) => {
        startTimes[id] = Date.now();
        await setTimeoutAsync(delayMs);
        endTimes[id] = Date.now();
        resolve(createMockUsage(modelId));
        return createMockJobResult(id);
      },
    });
    const promises = [
      limiter.queueJob({ ...createTrackedJob('A', JOB_DELAY_MS), jobType: DEFAULT_JOB_TYPE }),
      limiter.queueJob({ ...createTrackedJob('B', JOB_DELAY_MS), jobType: DEFAULT_JOB_TYPE }),
      limiter.queueJob({ ...createTrackedJob('C', SHORT_JOB_DELAY_MS), jobType: DEFAULT_JOB_TYPE }),
      limiter.queueJob({ ...createTrackedJob('D', SHORT_JOB_DELAY_MS), jobType: DEFAULT_JOB_TYPE }),
    ];
    await Promise.all(promises);
    const totalTime = Date.now() - start;
    const firstTwoEnded = Math.min(endTimes.A ?? start, endTimes.B ?? start);
    const lastTwoStarted = Math.min(startTimes.C ?? start, startTimes.D ?? start);
    expect(lastTwoStarted).toBeGreaterThanOrEqual(firstTwoEnded - TOLERANCE_MS);
    expect(totalTime).toBeGreaterThanOrEqual(JOB_DELAY_MS + SHORT_JOB_DELAY_MS - TOLERANCE_MS);
  });
});

const SLOW_JOB_DELAY_MS = 200;

describe('Blocking - memory actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should queue jobs when memory slots are exhausted', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      models: {
        default: { maxCapacity: MEMORY_MAX_CAPACITY_KB, pricing: ZERO_PRICING },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB } },
    });
    const jobOrder: string[] = [];
    const slowJobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        jobOrder.push('slow-start');
        await setTimeoutAsync(SLOW_JOB_DELAY_MS);
        jobOrder.push('slow-end');
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const fastJobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        jobOrder.push('fast-start');
        jobOrder.push('fast-end');
        resolve(createMockUsage(modelId));
        return createMockJobResult('fast');
      },
    });
    await Promise.all([slowJobPromise, fastJobPromise]);
    expect(jobOrder.indexOf('fast-start')).toBeGreaterThan(jobOrder.indexOf('slow-end'));
  });
});

describe('Blocking - rpm actually blocks jobs', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should block jobs when RPM limit is exhausted', async () => {
    const RPM_LIMIT = 2;
    limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: RPM_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT } },
    });
    const simpleJob = {
      jobId: generateJobId(),
      jobType: 'default' as const,
      job: ({ modelId }: { modelId: string }, resolve: (u: UsageEntry) => void) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job');
      },
    };
    await limiter.queueJob({ ...simpleJob, jobId: generateJobId() });
    await limiter.queueJob({ ...simpleJob, jobId: generateJobId() });
    expect(limiter.hasCapacity()).toBe(false);
    const timeoutPromise = setTimeoutAsync(TIMEOUT_MS).then(() => 'timeout' as const);
    const jobPromise = limiter
      .queueJob({ ...simpleJob, jobId: generateJobId() })
      .then(() => 'completed' as const);
    expect(await Promise.race([jobPromise, timeoutPromise])).toBe('timeout');
  });
});

describe('Blocking - tpm token reservation', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should reserve tokens before job execution and block when limit would be exceeded', async () => {
    const ESTIMATED_TOKENS = 50;
    const TPM_LIMIT = ESTIMATED_TOKENS * TWO;
    limiter = createLLMRateLimiter({
      models: {
        default: {
          tokensPerMinute: TPM_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedUsedTokens: ESTIMATED_TOKENS } },
    });
    const simpleJob = {
      jobId: generateJobId(),
      jobType: 'default' as const,
      job: ({ modelId }: { modelId: string }, resolve: (u: UsageEntry) => void) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job');
      },
    };
    await limiter.queueJob({ ...simpleJob, jobId: generateJobId() });
    let stats = limiter.getModelStats('default');
    expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob({ ...simpleJob, jobId: generateJobId() });
    stats = limiter.getModelStats('default');
    expect(stats.tokensPerMinute?.current).toBe(TPM_LIMIT);
    expect(limiter.hasCapacity()).toBe(false);
    const timeoutPromise = setTimeoutAsync(TIMEOUT_MS).then(() => 'timeout' as const);
    const jobPromise = limiter
      .queueJob({ ...simpleJob, jobId: generateJobId() })
      .then(() => 'completed' as const);
    expect(await Promise.race([jobPromise, timeoutPromise])).toBe('timeout');
  });
});

describe('Blocking - tpm never exceeds limit', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should never exceed token limit', async () => {
    const ESTIMATED_TOKENS = 100;
    limiter = createLLMRateLimiter({
      models: {
        default: {
          tokensPerMinute: ESTIMATED_TOKENS,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedUsedTokens: ESTIMATED_TOKENS } },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    const stats = limiter.getModelStats('default');
    expect(stats.tokensPerMinute?.current).toBeLessThanOrEqual(ESTIMATED_TOKENS);
    expect(stats.tokensPerMinute?.current).toBe(ESTIMATED_TOKENS);
  });
});

describe('Blocking - combined limiters block correctly', () => {
  let limiter: LLMRateLimiterInstance<'default'> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should block when any limiter is exhausted', async () => {
    const TEN = 10;
    limiter = createLLMRateLimiter({
      models: {
        default: {
          maxConcurrentRequests: ONE,
          requestsPerMinute: TEN,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT } },
    });
    const slowJobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.concurrency?.available).toBe(ZERO);
    expect(stats.requestsPerMinute?.remaining).toBe(NINE);
    await slowJobPromise;
  });
});
