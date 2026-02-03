import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

const redisURL = 'rediss://default:example.com:6379';

const estimates = {
  summary: {
    estimatedUsedTokens: 10000,
    estimatedNumberOfRequests: 1,
    ratio: {
      initialValue: 0.3,
    },
  },
  VacationPlanning: {
    estimatedUsedTokens: 2000,
    estimatedNumberOfRequests: 3,
    ratio: {
      initialValue: 0.4,
      flexible: false,
    },
  },
  ImageCreation: {
    estimatedUsedTokens: 5000,
    estimatedNumberOfRequests: 1,
  },
  BudgetCalculation: {
    estimatedUsedTokens: 3000,
    estimatedNumberOfRequests: 5,
  },
  WeatherForecast: {
    estimatedUsedTokens: 1000,
    estimatedNumberOfRequests: 1,
  },
};

const escalationOrder = ['openai/gpt-5.2', 'xai/grok-4.1-fast', 'deepinfra/gpt-oss-20b'] as const;

const models = {
  'openai/gpt-5.2': {
    requestsPerMinute: 500,
    tokensPerMinute: 500000,
    pricing: {
      input: 1.75,
      cached: 0.175,
      output: 14,
    },
  },
  'xai/grok-4.1-fast': {
    requestsPerMinute: 480,
    tokensPerMinute: 4000000,
    pricing: {
      input: 0.2,
      cached: 0.05,
      output: 0.5,
    },
  },
  'deepinfra/gpt-oss-20b': {
    maxConcurrentRequests: 200,
    pricing: {
      input: 0.03,
      cached: 0.03,
      output: 0.14,
    },
  },
};

const limiter = createLLMRateLimiter({
  label: 'server',
  backend: createRedisBackend(redisURL),
  models,
  escalationOrder,
  estimates,
});

limiter.start();
