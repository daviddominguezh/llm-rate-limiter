import {
  CONCURRENCY_LIMIT,
  DEFAULT_JOB_TYPE,
  DEFAULT_REQUEST_COUNT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  LONG_JOB_DELAY_MS,
  MEMORY_MAX_CAPACITY_KB,
  MOCK_TOTAL_TOKENS,
  ONE,
  RPD_LIMIT,
  RPM_LIMIT,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  TPD_LIMIT,
  TPM_LIMIT,
  ZERO,
  ZERO_PRICING,
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  setTimeoutAsync,
} from './limiterCombinations.helpers.js';
import type { LLMRateLimiterInstance } from './limiterCombinations.helpers.js';

describe('Individual Limiter - memory blocking', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should block when memory limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      models: {
        default: { maxCapacity: MEMORY_MAX_CAPACITY_KB, pricing: ZERO_PRICING },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: ONE },
      },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const jobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow-job');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    const stats = limiter.getModelStats('default');
    expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    expect(stats.memory?.availableKB).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await jobPromise;
  });
});

describe('Individual Limiter - memory restore', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should restore capacity after job completes', async () => {
    limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      models: {
        default: { maxCapacity: MEMORY_MAX_CAPACITY_KB, pricing: ZERO_PRICING },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB, estimatedNumberOfRequests: ONE },
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getModelStats('default');
    expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
    expect(stats.memory?.activeKB).toBe(ZERO);
  });
});

describe('Individual Limiter - concurrency blocking', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should block when concurrency limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: { default: { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: ZERO_PRICING } },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE } },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const jobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow-job');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    const stats = limiter.getModelStats('default');
    expect(stats.concurrency?.active).toBe(ONE);
    expect(stats.concurrency?.available).toBe(ZERO);
    expect(limiter.hasCapacity()).toBe(false);
    await jobPromise;
  });
});

describe('Individual Limiter - concurrency restore', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });
  it('should restore capacity after job completes', async () => {
    limiter = createLLMRateLimiter({
      models: { default: { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: ZERO_PRICING } },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE } },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getModelStats('default');
    expect(stats.concurrency?.available).toBe(ONE);
    expect(stats.concurrency?.active).toBe(ZERO);
  });
});

describe('Individual Limiter - rpm', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should block when RPM limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: RPM_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT } },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerMinute?.current).toBe(ONE);
  });
});

describe('Individual Limiter - rpd', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should block when RPD limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerDay: RPD_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT } },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.current).toBe(ONE);
  });
});

describe('Individual Limiter - tpm', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should block when TPM limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          tokensPerMinute: TPM_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedUsedTokens: MOCK_TOTAL_TOKENS, estimatedNumberOfRequests: ONE },
      },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});

describe('Individual Limiter - tpd', () => {
  let limiter: LLMRateLimiterInstance<typeof DEFAULT_JOB_TYPE> | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should block when TPD limit is exhausted', async () => {
    limiter = createLLMRateLimiter({
      models: {
        default: {
          tokensPerDay: TPD_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
      resourceEstimationsPerJob: {
        [DEFAULT_JOB_TYPE]: { estimatedUsedTokens: MOCK_TOTAL_TOKENS, estimatedNumberOfRequests: ONE },
      },
    });
    expect(limiter.hasCapacity()).toBe(true);
    await limiter.queueJob({
      jobId: generateJobId(),
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('job-1');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.current).toBe(MOCK_TOTAL_TOKENS);
  });
});
