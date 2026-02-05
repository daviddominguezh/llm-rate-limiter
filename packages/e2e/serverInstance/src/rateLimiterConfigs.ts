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
  models: Record<
    string,
    {
      requestsPerMinute?: number;
      requestsPerDay?: number;
      tokensPerMinute?: number;
      tokensPerDay?: number;
      maxConcurrentRequests?: number;
      pricing: {
        input: number;
        cached: number;
        output: number;
      };
    }
  >;
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
// Now with 3 job types: 1 fixed, 2 flexible
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
      ratio: { initialValue: 0.4, flexible: false }, // NOT flexible
    },
    flexibleJobTypeA: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.3, flexible: true }, // Flexible
    },
    flexibleJobTypeB: {
      estimatedUsedTokens: FIXED_RATIO_TOKENS,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.3, flexible: true }, // Flexible
    },
  },
};

// Expected with 2 instances:
// fixedJobType: floor((100K/10K) / 2 * 0.4) = floor(5 * 0.4) = 2 per instance = 4 total
// flexibleJobTypeA: floor((100K/10K) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total
// flexibleJobTypeB: floor((100K/10K) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total

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
// Slot Calculation Test Configs - Various Limit Types
// =============================================================================

// TPM-only config (same as slotCalculation but explicitly named)
export const slotCalcTpmConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: 100000,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.6 },
    },
    jobTypeB: {
      estimatedUsedTokens: 5000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.4 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((100K/10K) / 2 * 0.6) = 3
// jobTypeB: floor((100K/5K) / 2 * 0.4) = 4

// RPM-only config
export const slotCalcRpmConfig: RateLimiterPreset = {
  models: {
    'model-beta': {
      requestsPerMinute: 500,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-beta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 1000, // Not used for RPM calc
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.6 },
    },
    jobTypeB: {
      estimatedUsedTokens: 1000, // Not used for RPM calc
      estimatedNumberOfRequests: 5,
      ratio: { initialValue: 0.4 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((500/1) / 2 * 0.6) = 150
// jobTypeB: floor((500/5) / 2 * 0.4) = 20

// Concurrent-only config
export const slotCalcConcurrentConfig: RateLimiterPreset = {
  models: {
    'model-gamma': {
      maxConcurrentRequests: 100,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-gamma'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.7 },
    },
    jobTypeB: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.3 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor(100 / 2 * 0.7) = 35
// jobTypeB: floor(100 / 2 * 0.3) = 15

// Mixed limits config (TPM + RPM) - tests limiting factor
export const slotCalcTpmRpmConfig: RateLimiterPreset = {
  models: {
    'model-delta': {
      tokensPerMinute: 100000,
      requestsPerMinute: 50, // This is the limiting factor
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-delta'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5 },
    },
    jobTypeB: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5 },
    },
  },
};
// Expected with 2 instances (uses limiting factor):
// TPM-based: floor((100K/10K) / 2 * 0.5) = 2
// RPM-based: floor((50/1) / 2 * 0.5) = 12
// Actual: min(2, 12) = 2 (TPM is limiting)

// Multi-model config with different limit types
export const slotCalcMultiModelConfig: RateLimiterPreset = {
  models: {
    'model-tpm': {
      tokensPerMinute: 100000,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
    'model-concurrent': {
      maxConcurrentRequests: 50,
      pricing: { input: 0.5, cached: 0.05, output: 1 },
    },
  },
  escalationOrder: ['model-tpm', 'model-concurrent'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5 },
    },
    jobTypeB: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5 },
    },
  },
};
// Expected with 2 instances:
// model-tpm, jobTypeA: floor((100K/10K) / 2 * 0.5) = 2
// model-concurrent, jobTypeA: floor(50 / 2 * 0.5) = 12

// Various ratios config (3 job types)
export const slotCalcRatiosConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: 100000,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.5 },
    },
    jobTypeB: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.3 },
    },
    jobTypeC: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.2 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((100K/10K) / 2 * 0.5) = 2
// jobTypeB: floor((100K/10K) / 2 * 0.3) = 1
// jobTypeC: floor((100K/10K) / 2 * 0.2) = 1

// TPD-only config (Tokens Per Day)
export const slotCalcTpdConfig: RateLimiterPreset = {
  models: {
    'model-tpd': {
      tokensPerDay: 1000000, // 1M tokens per day
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-tpd'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.6 },
    },
    jobTypeB: {
      estimatedUsedTokens: 5000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.4 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((1M/10K) / 2 * 0.6) = floor(50 * 0.6) = 30
// jobTypeB: floor((1M/5K) / 2 * 0.4) = floor(100 * 0.4) = 40

// RPD-only config (Requests Per Day)
export const slotCalcRpdConfig: RateLimiterPreset = {
  models: {
    'model-rpd': {
      requestsPerDay: 10000, // 10K requests per day
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-rpd'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.6 },
    },
    jobTypeB: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 5,
      ratio: { initialValue: 0.4 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((10K/1) / 2 * 0.6) = floor(5000 * 0.6) = 3000
// jobTypeB: floor((10K/5) / 2 * 0.4) = floor(1000 * 0.4) = 400

// Uneven ratios config (4 job types: 0.7, 0.1, 0.1, 0.1)
export const slotCalcUnevenRatiosConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: 100000,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['model-alpha'],
  resourceEstimations: {
    jobTypeA: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.7 },
    },
    jobTypeB: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.1 },
    },
    jobTypeC: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.1 },
    },
    jobTypeD: {
      estimatedUsedTokens: 10000,
      estimatedNumberOfRequests: 1,
      ratio: { initialValue: 0.1 },
    },
  },
};
// Expected with 2 instances:
// jobTypeA: floor((100K/10K) / 2 * 0.7) = floor(5 * 0.7) = 3
// jobTypeB: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
// jobTypeC: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
// jobTypeD: floor((100K/10K) / 2 * 0.1) = floor(5 * 0.1) = 0
// Note: Low ratios may result in 0 slots per instance

// Memory-based slot calculation config
// Tests that memory is a LOCAL constraint: finalSlots = min(distributedSlots, floor(memoryForJobType / estimatedMemoryKB))
// Use high TPM so distributed slots are high, then memory becomes the limiting factor
const MEMORY_TEST_TPM = 10000000; // 10M TPM (very high, won't be limiting)
const MEMORY_TEST_HEAVY_KB = 10240; // 10MB per job (heavy memory usage)
const MEMORY_TEST_LIGHT_KB = 1024; // 1MB per job (light memory usage)

export const slotCalcMemoryConfig: RateLimiterPreset = {
  models: {
    'test-model': {
      tokensPerMinute: MEMORY_TEST_TPM,
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  escalationOrder: ['test-model'],
  resourceEstimations: {
    heavyMemoryJob: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 1,
      estimatedUsedMemoryKB: MEMORY_TEST_HEAVY_KB,
      ratio: { initialValue: 0.5 },
    },
    lightMemoryJob: {
      estimatedUsedTokens: 1000,
      estimatedNumberOfRequests: 1,
      estimatedUsedMemoryKB: MEMORY_TEST_LIGHT_KB,
      ratio: { initialValue: 0.5 },
    },
  },
};
// Memory slot calculation (assuming 100MB instance memory):
//
// Distributed slots (TPM-based, 2 instances):
//   heavyMemoryJob: floor((10M / 1K) / 2 * 0.5) = floor(2500) = 2500
//   lightMemoryJob: floor((10M / 1K) / 2 * 0.5) = floor(2500) = 2500
//
// Local memory slots (100MB total, split by ratio):
//   heavyMemoryJob memory = 100MB × 0.5 = 50MB
//   lightMemoryJob memory = 100MB × 0.5 = 50MB
//
//   heavyMemoryJob local = floor(50MB / 10MB) = 5 slots
//   lightMemoryJob local = floor(50MB / 1MB) = 50 slots
//
// Final (min of distributed and local):
//   heavyMemoryJob = min(2500, 5) = 5 slots   ← Memory limited
//   lightMemoryJob = min(2500, 50) = 50 slots ← Memory limited (but higher due to smaller memory footprint)

// =============================================================================
// Config Registry
// =============================================================================

export type ConfigPresetName =
  | 'default'
  | 'slotCalculation'
  | 'fixedRatio'
  | 'flexibleRatio'
  | 'instanceScaling'
  | 'slotCalc-tpm'
  | 'slotCalc-rpm'
  | 'slotCalc-tpd'
  | 'slotCalc-rpd'
  | 'slotCalc-concurrent'
  | 'slotCalc-tpm-rpm'
  | 'slotCalc-multi-model'
  | 'slotCalc-ratios'
  | 'slotCalc-uneven-ratios'
  | 'slotCalc-memory';

export const configPresets: Record<ConfigPresetName, RateLimiterPreset> = {
  default: defaultConfig,
  slotCalculation: slotCalculationConfig,
  fixedRatio: fixedRatioConfig,
  flexibleRatio: flexibleRatioConfig,
  instanceScaling: instanceScalingConfig,
  'slotCalc-tpm': slotCalcTpmConfig,
  'slotCalc-rpm': slotCalcRpmConfig,
  'slotCalc-tpd': slotCalcTpdConfig,
  'slotCalc-rpd': slotCalcRpdConfig,
  'slotCalc-concurrent': slotCalcConcurrentConfig,
  'slotCalc-tpm-rpm': slotCalcTpmRpmConfig,
  'slotCalc-multi-model': slotCalcMultiModelConfig,
  'slotCalc-ratios': slotCalcRatiosConfig,
  'slotCalc-uneven-ratios': slotCalcUnevenRatiosConfig,
  'slotCalc-memory': slotCalcMemoryConfig,
};

export const getConfigPreset = (name: ConfigPresetName): RateLimiterPreset => {
  const preset = configPresets[name];
  return preset;
};

export const isValidPresetName = (name: string): name is ConfigPresetName => {
  return name in configPresets;
};
