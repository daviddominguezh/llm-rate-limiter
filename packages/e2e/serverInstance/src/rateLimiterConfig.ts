import type { ResourceEstimationsPerJob } from '@llm-rate-limiter/core';

const OPENAI_RPM = 500;
const OPENAI_TPM = 500000;
const OPENAI_PRICING_INPUT = 1.75;
const OPENAI_PRICING_CACHED = 0.175;
const OPENAI_PRICING_OUTPUT = 14;

const XAI_RPM = 480;
const XAI_TPM = 4000000;
const XAI_PRICING_INPUT = 0.2;
const XAI_PRICING_CACHED = 0.05;
const XAI_PRICING_OUTPUT = 0.5;

const DEEPINFRA_MAX_CONCURRENT = 200;
const DEEPINFRA_PRICING_INPUT = 0.03;
const DEEPINFRA_PRICING_CACHED = 0.03;
const DEEPINFRA_PRICING_OUTPUT = 0.14;

const SUMMARY_TOKENS = 10000;
const SUMMARY_REQUESTS = 1;
const SUMMARY_RATIO = 0.3;

const VACATION_TOKENS = 2000;
const VACATION_REQUESTS = 3;
const VACATION_RATIO = 0.4;

const IMAGE_TOKENS = 5000;
const IMAGE_REQUESTS = 1;

const BUDGET_TOKENS = 3000;
const BUDGET_REQUESTS = 5;

const WEATHER_TOKENS = 1000;
const WEATHER_REQUESTS = 1;

// Escalation test: short maxWaitMS on primary model to trigger escalation
const ESCALATION_TEST_TOKENS = 10000;
const ESCALATION_TEST_REQUESTS = 1;
const ESCALATION_TEST_MAX_WAIT_MS = 2000; // 2 seconds - short timeout to trigger escalation

export const ESCALATION_ORDER = ['openai/gpt-5.2', 'xai/grok-4.1-fast', 'deepinfra/gpt-oss-20b'] as const;

export const MODELS = {
  'openai/gpt-5.2': {
    requestsPerMinute: OPENAI_RPM,
    tokensPerMinute: OPENAI_TPM,
    pricing: {
      input: OPENAI_PRICING_INPUT,
      cached: OPENAI_PRICING_CACHED,
      output: OPENAI_PRICING_OUTPUT,
    },
  },
  'xai/grok-4.1-fast': {
    requestsPerMinute: XAI_RPM,
    tokensPerMinute: XAI_TPM,
    pricing: {
      input: XAI_PRICING_INPUT,
      cached: XAI_PRICING_CACHED,
      output: XAI_PRICING_OUTPUT,
    },
  },
  'deepinfra/gpt-oss-20b': {
    maxConcurrentRequests: DEEPINFRA_MAX_CONCURRENT,
    pricing: {
      input: DEEPINFRA_PRICING_INPUT,
      cached: DEEPINFRA_PRICING_CACHED,
      output: DEEPINFRA_PRICING_OUTPUT,
    },
  },
};

export const RESOURCE_ESTIMATIONS: ResourceEstimationsPerJob = {
  summary: {
    estimatedUsedTokens: SUMMARY_TOKENS,
    estimatedNumberOfRequests: SUMMARY_REQUESTS,
    ratio: {
      initialValue: SUMMARY_RATIO,
    },
  },
  VacationPlanning: {
    estimatedUsedTokens: VACATION_TOKENS,
    estimatedNumberOfRequests: VACATION_REQUESTS,
    ratio: {
      initialValue: VACATION_RATIO,
      flexible: false,
    },
  },
  ImageCreation: {
    estimatedUsedTokens: IMAGE_TOKENS,
    estimatedNumberOfRequests: IMAGE_REQUESTS,
  },
  BudgetCalculation: {
    estimatedUsedTokens: BUDGET_TOKENS,
    estimatedNumberOfRequests: BUDGET_REQUESTS,
  },
  WeatherForecast: {
    estimatedUsedTokens: WEATHER_TOKENS,
    estimatedNumberOfRequests: WEATHER_REQUESTS,
  },
  // Job type with short maxWaitMS on primary model - used to test escalation behavior
  escalationTest: {
    estimatedUsedTokens: ESCALATION_TEST_TOKENS,
    estimatedNumberOfRequests: ESCALATION_TEST_REQUESTS,
    maxWaitMS: {
      'openai/gpt-5.2': ESCALATION_TEST_MAX_WAIT_MS,
    },
  },
};
