/**
 * Branch coverage tests for pricing and cost calculation.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { TestableConfig } from './coverage.branches.helpers.js';
import { FIFTY, HUNDRED, ONE, TEN, ZERO } from './coverage.branches.helpers.js';

const DEFAULT_JOB_TYPE = 'default';

describe('multiModelRateLimiter - calculateCost with undefined pricing', () => {
  it('should return zero cost when pricing is undefined', async () => {
    const limiter = createLLMRateLimiter({
      models: {
        default: {
          requestsPerMinute: TEN,
          pricing: { input: ONE, cached: ONE, output: ONE },
        },
      },
      resourceEstimationsPerJob: { [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE } },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Testing defensive code path for undefined pricing
    const { models } = Reflect.get(limiter, 'config') as TestableConfig;
    const { default: defaultModel } = models;
    if (defaultModel !== undefined) {
      delete defaultModel.pricing;
    }
    let capturedCost = -ONE;
    await limiter.queueJob({
      jobId: 'no-pricing',
      jobType: DEFAULT_JOB_TYPE,
      job: ({ modelId }, resolve) => {
        resolve({ modelId, inputTokens: HUNDRED, cachedTokens: ZERO, outputTokens: FIFTY });
        return { requestCount: ONE, usage: { input: HUNDRED, output: FIFTY, cached: ZERO } };
      },
      onComplete: (_, { totalCost }) => {
        capturedCost = totalCost;
      },
    });
    expect(capturedCost).toBe(ZERO);
    limiter.stop();
  });
});
