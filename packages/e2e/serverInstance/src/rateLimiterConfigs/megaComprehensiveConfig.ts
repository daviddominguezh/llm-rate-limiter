/**
 * Configuration preset for the mega comprehensive E2E test (Test 50).
 * 3 models, 4 job types, all 5 rate dimensions, memory, escalation chain.
 */
import type { RateLimiterPreset } from './types.js';

// Pricing constants
const PRICE_ALPHA_INPUT = 10;
const PRICE_ALPHA_CACHED = 5;
const PRICE_ALPHA_OUTPUT = 30;
const PRICE_BETA_INPUT = 5;
const PRICE_BETA_CACHED = 2;
const PRICE_BETA_OUTPUT = 15;
const PRICE_GAMMA_INPUT = 1;
const PRICE_GAMMA_CACHED = 0;
const PRICE_GAMMA_OUTPUT = 3;

// Pricing per model (using integer-scale values)
const ALPHA_PRICING = { input: PRICE_ALPHA_INPUT, cached: PRICE_ALPHA_CACHED, output: PRICE_ALPHA_OUTPUT };
const BETA_PRICING = { input: PRICE_BETA_INPUT, cached: PRICE_BETA_CACHED, output: PRICE_BETA_OUTPUT };
const GAMMA_PRICING = { input: PRICE_GAMMA_INPUT, cached: PRICE_GAMMA_CACHED, output: PRICE_GAMMA_OUTPUT };

// model-alpha: all 5 rate dimensions
const ALPHA_TPM = 30000;
const ALPHA_RPM = 6;
const ALPHA_CONCURRENT = 3;
const ALPHA_TPD = 500000;
const ALPHA_RPD = 200;

// model-beta: higher capacity
const BETA_TPM = 300000;
const BETA_RPM = 60;
const BETA_CONCURRENT = 30;

// model-gamma: very high capacity
const GAMMA_TPM = 3000000;
const GAMMA_RPM = 600;
const GAMMA_CONCURRENT = 300;

// Job type resource estimations
const ESTIMATED_TOKENS = 10000;
const ESTIMATED_REQUESTS = 1;
const ESTIMATED_MEMORY_KB = 20480;

// Ratios (must sum to 1.0)
const CRITICAL_RATIO = 0.4;
const STANDARD_RATIO = 0.3;
const LOW_PRIORITY_RATIO = 0.1;
const FIXED_BATCH_RATIO = 0.2;

// maxWaitMS per model per job type
const MAX_WAIT_ZERO = 0;
const MAX_WAIT_CRITICAL_ALPHA = 30000;
const MAX_WAIT_CRITICAL_BETA = 15000;
const MAX_WAIT_CRITICAL_GAMMA = 5000;
const MAX_WAIT_STANDARD_ALPHA = 10000;
const MAX_WAIT_STANDARD_BETA = 5000;
const MAX_WAIT_STANDARD_GAMMA = 2000;
const MAX_WAIT_FIXED_ALPHA = 30000;
const MAX_WAIT_FIXED_BETA = 15000;

// Memory (256000 * 0.8 = 204800 usable; lowPriority @ 0.1 gets 20480 KB = 1 slot minimum)
const MAX_MEMORY_KB = 256000;
const FREE_MEMORY_RATIO = 0.8;

// Ratio adjustment
const ADJUSTMENT_INTERVAL_MS = 10000;

export const megaComprehensiveConfig: RateLimiterPreset = {
  models: {
    'model-alpha': {
      tokensPerMinute: ALPHA_TPM,
      requestsPerMinute: ALPHA_RPM,
      maxConcurrentRequests: ALPHA_CONCURRENT,
      tokensPerDay: ALPHA_TPD,
      requestsPerDay: ALPHA_RPD,
      pricing: ALPHA_PRICING,
    },
    'model-beta': {
      tokensPerMinute: BETA_TPM,
      requestsPerMinute: BETA_RPM,
      maxConcurrentRequests: BETA_CONCURRENT,
      pricing: BETA_PRICING,
    },
    'model-gamma': {
      tokensPerMinute: GAMMA_TPM,
      requestsPerMinute: GAMMA_RPM,
      maxConcurrentRequests: GAMMA_CONCURRENT,
      pricing: GAMMA_PRICING,
    },
  },
  escalationOrder: ['model-alpha', 'model-beta', 'model-gamma'],
  resourceEstimations: {
    critical: {
      estimatedUsedTokens: ESTIMATED_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
      ratio: { initialValue: CRITICAL_RATIO },
      maxWaitMS: {
        'model-alpha': MAX_WAIT_CRITICAL_ALPHA,
        'model-beta': MAX_WAIT_CRITICAL_BETA,
        'model-gamma': MAX_WAIT_CRITICAL_GAMMA,
      },
    },
    standard: {
      estimatedUsedTokens: ESTIMATED_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
      ratio: { initialValue: STANDARD_RATIO },
      maxWaitMS: {
        'model-alpha': MAX_WAIT_STANDARD_ALPHA,
        'model-beta': MAX_WAIT_STANDARD_BETA,
        'model-gamma': MAX_WAIT_STANDARD_GAMMA,
      },
    },
    lowPriority: {
      estimatedUsedTokens: ESTIMATED_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
      ratio: { initialValue: LOW_PRIORITY_RATIO },
      maxWaitMS: {
        'model-alpha': MAX_WAIT_ZERO,
        'model-beta': MAX_WAIT_ZERO,
        'model-gamma': MAX_WAIT_ZERO,
      },
    },
    fixedBatch: {
      estimatedUsedTokens: ESTIMATED_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB,
      ratio: { initialValue: FIXED_BATCH_RATIO, flexible: false },
      maxWaitMS: {
        'model-alpha': MAX_WAIT_FIXED_ALPHA,
        'model-beta': MAX_WAIT_FIXED_BETA,
      },
    },
  },
  memory: {
    maxMemoryKB: MAX_MEMORY_KB,
    freeMemoryRatio: FREE_MEMORY_RATIO,
  },
  ratioAdjustmentConfig: {
    adjustmentIntervalMs: ADJUSTMENT_INTERVAL_MS,
  },
};
