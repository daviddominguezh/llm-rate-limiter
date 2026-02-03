/**
 * Coverage tests for misc functionality.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { LLMRateLimiterConfig } from '../multiModelTypes.js';
import { DELAY_SHORT, FIFTY, HUNDRED, ONE, TEN, THOUSAND, ZERO } from './coverage.helpers.js';
import {
  createMockJobResult as createHelperMockJobResult,
  createLLMRateLimiter as createTestLimiter,
  queueDelayedJob,
  queueSimpleJob,
} from './limiterCombinations.helpers.js';
import {
  DEFAULT_JOB_TYPE,
  createDefaultResourceEstimations,
  ensureDefined,
} from './multiModelRateLimiter.helpers.js';

describe('multiModelRateLimiter - pricing undefined', () => {
  it('should return zero cost when model has no pricing', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: { input: ZERO, cached: ZERO, output: ZERO },
        },
      },
      resourceEstimationsPerJob: createDefaultResourceEstimations(),
    });
    let capturedCost = -ONE;
    await limiter.queueJob({
      jobId: 'test-no-pricing',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: HUNDRED, cachedTokens: ZERO, outputTokens: FIFTY });
        return { requestCount: ONE, usage: { input: HUNDRED, output: FIFTY, cached: ZERO } };
      },
      onComplete: (_, context) => {
        const { totalCost } = context;
        capturedCost = totalCost;
      },
    });
    expect(capturedCost).toBe(ZERO);
    limiter.stop();
  });
});

describe('helper functions - queue helpers and ensureDefined', () => {
  const modelConfig = {
    tokensPerMinute: THOUSAND * TEN,
    pricing: { input: ZERO, cached: ZERO, output: ZERO },
  };

  const limiterConfig: LLMRateLimiterConfig = {
    models: { default: modelConfig },
    resourceEstimationsPerJob: createDefaultResourceEstimations(),
  };

  it('should use queueSimpleJob helper', async () => {
    const limiter = createTestLimiter(limiterConfig);
    const result = await queueSimpleJob(limiter, createHelperMockJobResult('simple-test'));
    expect(result.text).toBe('simple-test');
    limiter.stop();
  });

  it('should use queueDelayedJob helper', async () => {
    const limiter = createTestLimiter(limiterConfig);
    const result = await queueDelayedJob(limiter, 'delayed-test', DELAY_SHORT);
    expect(result.text).toBe('delayed-test');
    limiter.stop();
  });

  it('should throw from ensureDefined when value is undefined or null', () => {
    expect(() => {
      ensureDefined(undefined);
    }).toThrow('Expected value to be defined');
    expect(() => {
      ensureDefined(null);
    }).toThrow('Expected value to be defined');
    expect(() => {
      ensureDefined(undefined, 'Custom error');
    }).toThrow('Custom error');
  });
});
