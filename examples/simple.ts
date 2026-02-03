import { createLLMRateLimiter } from '@llm-rate-limiter/core';

// Create rate limiter with Redis backend
const limiter = createLLMRateLimiter({
  models: {
    'gpt-5.2': {
      requestsPerMinute: 500,
      pricing: {
        input: 0.03,
        output: 0.06,
        cached: 0.015,
      },
    },
  },
  resourceEstimationsPerJob: {
    createRecipe: { estimatedUsedTokens: 10000 },
  },
});

// Start (registers with Redis for slot allocation)
await limiter.start();

// Use normally...
const result = await limiter.queueJob({
  jobId: 'job-id',
  jobType: 'createRecipe',
  job: () => {
    const usage = { inputTokens: 100, cachedTokens: 0, outputTokens: 500, requestCount: 0 };
    return {
      ...usage,
      data: 'My awesome recipe',
    };
  },
});

console.log(result.data); // Lorem ipsum...

// Stop (unregisters from Redis)
limiter.stop();
