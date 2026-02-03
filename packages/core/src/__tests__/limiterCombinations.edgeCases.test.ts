import {
  CONCURRENCY_LIMIT,
  ESTIMATED_MEMORY_KB,
  FREE_MEMORY_RATIO,
  HIGH_CONCURRENCY,
  HIGH_RPM,
  HUNDRED,
  HUNDRED_THOUSAND,
  LONG_JOB_DELAY_MS,
  MEMORY_MAX_CAPACITY_KB,
  MOCK_TOTAL_TOKENS,
  ONE,
  RPD_LIMIT,
  RPM_LIMIT,
  SEMAPHORE_ACQUIRE_WAIT_MS,
  TEN,
  TEN_THOUSAND,
  TPD_LIMIT,
  TPM_LIMIT,
  TWO,
  ZERO,
  ZERO_PRICING,
  buildHighLimitConfig,
  combinations,
  createLLMRateLimiter,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  getBlockingReason,
  setTimeoutAsync,
} from './limiterCombinations.helpers.js';

describe('EdgeCase - getBlockingReason returns null', () => {
  it('should return null when no limiter is blocking', () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: HIGH_RPM, pricing: ZERO_PRICING } },
    });
    const result = getBlockingReason(limiter, ['rpm']);
    expect(result).toBeNull();
    limiter.stop();
  });
});

describe('EdgeCase - buildHighLimitConfig with concurrency only', () => {
  it('should build config without memory when only concurrency is set', () => {
    const config = buildHighLimitConfig(['concurrency']);
    const {
      models: { default: modelConfig },
    } = config;
    if (modelConfig === undefined) {
      throw new Error('Expected default model config to be defined');
    }
    expect(modelConfig.maxConcurrentRequests).toBe(HIGH_CONCURRENCY);
    const limiter = createLLMRateLimiter(config);
    expect(limiter.hasCapacity()).toBe(true);
    limiter.stop();
  });
});

describe('EdgeCase - combinations helper edge cases', () => {
  it('should return empty array for non-positive k with non-empty array', () => {
    const result = combinations(['a', 'b', 'c'], ZERO);
    expect(result).toEqual([[]]);
  });

  it('should return empty array for empty input array', () => {
    const result = combinations([], TWO);
    expect(result).toEqual([]);
  });
});

describe('EdgeCase - memory and concurrency exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      models: { default: { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: ZERO_PRICING } },
      resourcesPerJob: { default: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB } },
    });
    const jobPromise = limiter.queueJob({
      jobId: generateJobId(),
      jobType: 'default',
      job: async ({ modelId }, resolve) => {
        await setTimeoutAsync(LONG_JOB_DELAY_MS);
        resolve(createMockUsage(modelId));
        return createMockJobResult('slow-job');
      },
    });
    await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.memory?.availableKB).toBe(ZERO);
    expect(stats.concurrency?.available).toBe(ZERO);
    await jobPromise;
    limiter.stop();
  });
});

describe('EdgeCase - rpm and rpd exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: RPM_LIMIT, requestsPerDay: RPD_LIMIT, pricing: ZERO_PRICING } },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('exhaust-job');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

describe('EdgeCase - tpm and tpd exhausted', () => {
  it('should report no capacity when both are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { tokensPerMinute: TPM_LIMIT, tokensPerDay: TPD_LIMIT, pricing: ZERO_PRICING } },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('exhaust-job');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

describe('EdgeCase - all time-based limiters exhausted', () => {
  it('should report no capacity when all are exhausted', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: RPM_LIMIT,
          requestsPerDay: RPD_LIMIT,
          tokensPerMinute: TPM_LIMIT,
          tokensPerDay: TPD_LIMIT,
          pricing: ZERO_PRICING,
        },
      },
    });
    await limiter.queueJob({
      jobId: generateJobId(),
      job: ({ modelId }, resolve) => {
        resolve(createMockUsage(modelId));
        return createMockJobResult('exhaust-job');
      },
    });
    expect(limiter.hasCapacity()).toBe(false);
    const stats = limiter.getModelStats('default');
    expect(stats.requestsPerMinute?.remaining).toBe(ZERO);
    expect(stats.requestsPerDay?.remaining).toBe(ZERO);
    expect(stats.tokensPerMinute?.remaining).toBe(ZERO);
    expect(stats.tokensPerDay?.remaining).toBe(ZERO);
    limiter.stop();
  });
});

const createFailingJob = async (): Promise<never> => await Promise.reject(new Error('Intentional failure'));

describe('EdgeCase - release memory on error', () => {
  it('should release memory and concurrency on job failure', async () => {
    const limiter = createLLMRateLimiter({
      memory: { freeMemoryRatio: FREE_MEMORY_RATIO },
      maxCapacity: MEMORY_MAX_CAPACITY_KB,
      models: { default: { maxConcurrentRequests: CONCURRENCY_LIMIT, pricing: ZERO_PRICING } },
      resourcesPerJob: { default: { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB } },
    });
    await expect(
      limiter.queueJob({
        jobId: generateJobId(),
        jobType: 'default',
        job: createFailingJob,
      })
    ).rejects.toThrow('Intentional failure');
    expect(limiter.hasCapacity()).toBe(true);
    const stats = limiter.getModelStats('default');
    expect(stats.memory?.availableKB).toBe(MEMORY_MAX_CAPACITY_KB);
    expect(stats.concurrency?.available).toBe(ONE);
    limiter.stop();
  });
});

describe('EdgeCase - request counters on error', () => {
  it('should still increment request counters even on job failure', async () => {
    const limiter = createLLMRateLimiter({
      models: { default: { requestsPerMinute: TEN, requestsPerDay: HUNDRED, pricing: ZERO_PRICING } },
    });
    await expect(
      limiter.queueJob({
        jobId: generateJobId(),
        job: createFailingJob,
      })
    ).rejects.toThrow('Intentional failure');
    const stats = limiter.getModelStats('default');
    expect(stats.requestsPerMinute?.current).toBe(ONE);
    expect(stats.requestsPerDay?.current).toBe(ONE);
    limiter.stop();
  });
});

describe('EdgeCase - token counters on error', () => {
  it('should still reserve tokens even on job failure', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: { tokensPerMinute: TEN_THOUSAND, tokensPerDay: HUNDRED_THOUSAND, pricing: ZERO_PRICING },
      },
    });
    await expect(
      limiter.queueJob({
        jobId: generateJobId(),
        job: createFailingJob,
      })
    ).rejects.toThrow('Intentional failure');
    limiter.stop();
  });
});
