/**
 * Configuration presets for E2E testing different scenarios.
 * Each preset defines models, escalation order, and resource estimations.
 */
import type { ResourceEstimationsPerJob } from '@llm-rate-limiter/core';

// =============================================================================
// Shared Constants
// =============================================================================

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

// =============================================================================
// Config Type
// =============================================================================

export interface RateLimiterPreset {
  models: Record<string, {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
    maxConcurrentRequests?: number;
    pricing: {
      input: number;
      cached: number;
      output: number;
    };
  }>;
  escalationOrder: readonly string[];
  resourceEstimations: ResourceEstimationsPerJob;
}

// =============================================================================
// Default Config (original)
// =============================================================================

export const defaultConfig: RateLimiterPreset = {
  models: {
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
  },
  escalationOrder: ['openai/gpt-5.2', 'xai/grok-4.1-fast', 'deepinfra/gpt-oss-20b'],
  resourceEstimations: {
    summary: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.3 },
    },
    VacationPlanning: {
      estimatedUsedTokens: 2000,
      estimatedNumberOfRequests: 3,
      ratio: { initialValue: 0.4, flexible: false },
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
  },
};

// =============================================================================
// Multi-Dimensional Slot Test Config
// Tests slot calculation with simple, verifiable numbers
// =============================================================================

const SLOT_TEST_TPM = 100000; // 100K TPM for easy calculation
const SLOT_TEST_TOKENS_A = 10000; // 10K tokens per job = 10 slots base
const SLOT_TEST_TOKENS_B = 5000; // 5K tokens per job = 20 slots base
const SLOT_TEST_RATIO_A = 0.6;
const SLOT_TEST_RATIO_B = 0.4;

export const slotCalculationConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: SLOT_TEST_TPM,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
    'model-beta': {
      tokensPerMinute: SLOT_TEST_TPM,
      pricing: { input: 0.5, cached: 0.05, output: 1 },
    },
  },
  escalationOrder: ['model-alpha', 'model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: SLOT_TEST_TOKENS_A,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: SLOT_TEST_RATIO_A },
    },
    jobTypeB: {
      estimatedUsedTokens: SLOT_TEST_TOKENS_B,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: SLOT_TEST_RATIO_B },
    },
  },
};

// Expected slots with 1 instance:
// model-alpha, jobTypeA: floor((100K/10K) / 1 * 0.6) = floor(10 * 0.6) = 6
// model-alpha, jobTypeB: floor((100K/5K) / 1 * 0.4) = floor(20 * 0.4) = 8
// model-beta, jobTypeA: floor((100K/10K) / 1 * 0.6) = floor(10 * 0.6) = 6
// model-beta, jobTypeB: floor((100K/5K) / 1 * 0.4) = floor(20 * 0.4) = 8

// Expected slots with 2 instances:
// model-alpha, jobTypeA: floor((100K/10K) / 2 * 0.6) = floor(5 * 0.6) = 3
// model-alpha, jobTypeB: floor((100K/5K) / 2 * 0.4) = floor(10 * 0.4) = 4
// etc.

// =============================================================================
// Fixed Ratio Isolation Test Config
// Tests that non-flexible ratios are not affected by load on other job types
// =============================================================================

const FIXED_RATIO_TPM = 100000;
const FIXED_RATIO_TOKENS = 10000; // 10 slots base per job type

export const fixedRatioConfig: RateLimiterPreset = {
  models: {
    'test-model': {
      tokensPerMinute: FIXED_RATIO_TPM,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['test-model'],
  resourceEstimations: {
    fixedJobType: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5, flexible: false }, // NOT flexible
    },
    flexibleJobType: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5, flexible: true }, // Flexible (default)
    },
  },
};

// Expected: fixedJobType always gets 5 slots (50% of 10)
// flexibleJobType can grow/shrink but fixedJobType stays at 5

// =============================================================================
// Flexible Ratio Adjustment Test Config
// Tests that flexible job types adjust ratios based on load
// =============================================================================

const FLEX_TPM = 100000;
const FLEX_TOKENS = 10000;
const FLEX_INITIAL_RATIO = 0.33; // ~33% each for 3 job types

export const flexibleRatioConfig: RateLimiterPreset = {
  models: {
    'flex-model': {
      tokensPerMinute: FLEX_TPM,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['flex-model'],
  resourceEstimations: {
    flexJobA: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: FLEX_INITIAL_RATIO, flexible: true },
    },
    flexJobB: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: FLEX_INITIAL_RATIO, flexible: true },
    },
    flexJobC: {
      estimatedUsedTokens: FLEX_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: FLEX_INITIAL_RATIO, flexible: true },
    },
  },
};

// Expected: When flexJobA is overloaded and flexJobB is idle,
// ratio should shift from B to A

// =============================================================================
// Instance Scaling Test Config
// Simple config for testing instance join/leave behavior
// =============================================================================

const SCALE_TPM = 100000;
const SCALE_TOKENS = 10000; // 10 slots base

export const instanceScalingConfig: RateLimiterPreset = {
  models: {
    'scale-model': {
      tokensPerMinute: SCALE_TPM,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['scale-model'],
  resourceEstimations: {
    scaleJob: {
      estimatedUsedTokens: SCALE_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 1.0 }, // 100% to single job type
    },
  },
};

// Expected with 1 instance: 10 slots
// Expected with 2 instances: 5 slots each

// =============================================================================
// Config Registry
// =============================================================================

export type ConfigPresetName =
  | 'default'
  | 'slotCalculation'
  | 'fixedRatio'
  | 'flexibleRatio'
  | 'instanceScaling';

export const configPresets: Record<ConfigPresetName, RateLimiterPreset> = {
  default: defaultConfig,
  slotCalculation: slotCalculationConfig,
  fixedRatio: fixedRatioConfig,
  flexibleRatio: flexibleRatioConfig,
  instanceScaling: instanceScalingConfig,
};

export const getConfigPreset = (name: ConfigPresetName): RateLimiterPreset => {
  const preset = configPresets[name];
  return preset;
};

export const isValidPresetName = (name: string): name is ConfigPresetName => {
  return name in configPresets;
};
