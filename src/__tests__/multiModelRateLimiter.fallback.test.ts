import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterInstance } from '../multiModelTypes.js';
import type { MockJobResult } from './multiModelRateLimiter.helpers.js';
import {
  DEFAULT_PRICING,
  DELAY_MS_MEDIUM,
  DELAY_MS_SHORT,
  MOCK_TOTAL_TOKENS,
  ONE,
  RPM_LIMIT_HIGH,
  RPM_LIMIT_LOW,
  ZERO,
  createJobOptions,
  createMockJobResult,
  createMockUsage,
  generateJobId,
  simpleJob,
} from './multiModelRateLimiter.helpers.js';

describe('MultiModelRateLimiter - automatic fallback RPM', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should fallback to second model when first is exhausted (RPM)', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': {
          requestsPerMinute: RPM_LIMIT_LOW,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
        'gpt-3.5': {
          requestsPerMinute: RPM_LIMIT_HIGH,
          resourcesPerEvent: { estimatedNumberOfRequests: ONE },
          pricing: DEFAULT_PRICING,
        },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result1 = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(result1.modelUsed).toBe('gpt-4');
    const result2 = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result2.modelUsed).toBe('gpt-3.5');
  });
});

describe('MultiModelRateLimiter - automatic fallback concurrency', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should fallback to second model when first is exhausted (concurrency)', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
        'gpt-3.5': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const modelsUsed: string[] = [];
    const job1Promise = limiter.queueJob(
      createJobOptions(async ({ modelId }) => {
        modelsUsed.push(modelId);
        await setTimeoutAsync(DELAY_MS_MEDIUM);
        return createMockJobResult('job-1');
      })
    );
    await setTimeoutAsync(DELAY_MS_SHORT);
    const job2Promise = limiter.queueJob(
      createJobOptions(({ modelId }) => {
        modelsUsed.push(modelId);
        return createMockJobResult('job-2');
      })
    );
    await Promise.all([job1Promise, job2Promise]);
    expect(modelsUsed).toEqual(['gpt-4', 'gpt-3.5']);
  });
});

const TPM_LIMIT = 10000;
const TPM_LIMIT_LOW = MOCK_TOTAL_TOKENS;
const TPM_LIMIT_HIGH = 100000;

describe('MultiModelRateLimiter - token limits fallback', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => { limiter?.stop(); limiter = undefined; });

  it('should track token usage per model', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { tokensPerMinute: TPM_LIMIT, resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS }, pricing: DEFAULT_PRICING } },
    });
    await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(limiter.getModelStats('gpt-4').tokensPerMinute?.current).toBe(MOCK_TOTAL_TOKENS);
  });

  it('should fallback when token limit is reached', async () => {
    limiter = createLLMRateLimiter({
      models: {
        'gpt-4': { tokensPerMinute: TPM_LIMIT_LOW, resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS }, pricing: DEFAULT_PRICING },
        'gpt-3.5': { tokensPerMinute: TPM_LIMIT_HIGH, resourcesPerEvent: { estimatedUsedTokens: MOCK_TOTAL_TOKENS }, pricing: DEFAULT_PRICING },
      },
      order: ['gpt-4', 'gpt-3.5'],
    });
    const result1 = await limiter.queueJob(simpleJob(createMockJobResult('job-1')));
    expect(result1.modelUsed).toBe('gpt-4');
    const result2 = await limiter.queueJob(simpleJob(createMockJobResult('job-2')));
    expect(result2.modelUsed).toBe('gpt-3.5');
  });
});

describe('MultiModelRateLimiter - job errors queueJob', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should propagate job errors when reject with delegate false', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING } },
    });
    const failingJob = {
      jobId: generateJobId(),
      job: (
        args: { modelId: string },
        _resolve: (u: {
          modelId: string;
          inputTokens: number;
          cachedTokens: number;
          outputTokens: number;
        }) => void,
        reject: (
          u: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number },
          opts?: { delegate?: boolean }
        ) => void
      ): MockJobResult => {
        reject(createMockUsage(args.modelId), { delegate: false });
        return createMockJobResult('never');
      },
    };
    await expect(limiter.queueJob(failingJob)).rejects.toThrow('Job rejected without delegation');
    const stats = limiter.getModelStats('gpt-4');
    expect(stats.concurrency?.active).toBe(ZERO);
  });
});

describe('MultiModelRateLimiter - job errors queueJobForModel', () => {
  let limiter: LLMRateLimiterInstance | undefined = undefined;
  afterEach(() => {
    limiter?.stop();
    limiter = undefined;
  });

  it('should propagate queueJobForModel errors', async () => {
    limiter = createLLMRateLimiter({
      models: { 'gpt-4': { maxConcurrentRequests: ONE, pricing: DEFAULT_PRICING } },
    });
    const failingJob = async (): Promise<MockJobResult> => {
      await Promise.reject(new Error('Specific model job failed'));
      return createMockJobResult('never');
    };
    await expect(limiter.queueJobForModel('gpt-4', failingJob)).rejects.toThrow('Specific model job failed');
    const stats = limiter.getModelStats('gpt-4');
    expect(stats.concurrency?.active).toBe(ZERO);
  });
});
