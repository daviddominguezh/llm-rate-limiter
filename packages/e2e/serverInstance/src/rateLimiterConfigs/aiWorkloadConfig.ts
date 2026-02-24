/**
 * Configuration preset for the AI Workload E2E test.
 *
 * 2 models: anthropic-opus-4.6 (TPM=450K, RPM=1K), openai-gpt-5.2 (TPM=1M, RPM=5K)
 * 3 job types: brainstorm (0.3), summarize (0.2), analyzePDF (0.5 fixed)
 *
 * Pool totalSlots (avgTokens = floor((10K+30K+50K)/3) = 30K):
 * - Anthropic: floor(450K/30K) = 15
 * - OpenAI:    floor(1M/30K)   = 33
 *
 * Expected per-model per-jobType slots (1 instance, min of TPM/RPM/pool dimensions):
 * - Anthropic: brainstorm=4, summarize=3, analyzePDF=4
 * - OpenAI:    brainstorm=9, summarize=6, analyzePDF=10
 */
import type { RateLimiterPreset } from './types.js';

// Model rate limits
const ANTHROPIC_TPM = 450000;
const ANTHROPIC_RPM = 1000;
const OPENAI_TPM = 1000000;
const OPENAI_RPM = 5000;

// Pricing (per million tokens, integer-scale)
const ANTHROPIC_INPUT_PRICE = 15;
const ANTHROPIC_CACHED_PRICE = 7;
const ANTHROPIC_OUTPUT_PRICE = 75;
const OPENAI_INPUT_PRICE = 5;
const OPENAI_CACHED_PRICE = 2;
const OPENAI_OUTPUT_PRICE = 15;

const ANTHROPIC_PRICING = {
  input: ANTHROPIC_INPUT_PRICE,
  cached: ANTHROPIC_CACHED_PRICE,
  output: ANTHROPIC_OUTPUT_PRICE,
};
const OPENAI_PRICING = {
  input: OPENAI_INPUT_PRICE,
  cached: OPENAI_CACHED_PRICE,
  output: OPENAI_OUTPUT_PRICE,
};

// Job type resource estimations
const BRAINSTORM_TOKENS = 10000;
const SUMMARIZE_TOKENS = 30000;
const ANALYZE_PDF_TOKENS = 50000;
const ESTIMATED_REQUESTS = 1;

// Ratios (must sum to 1.0)
const BRAINSTORM_RATIO = 0.3;
const SUMMARIZE_RATIO = 0.2;
const ANALYZE_PDF_RATIO = 0.5;

// maxWaitMS per model per job type
const MAX_WAIT_HIGH = 60000;
const MAX_WAIT_MEDIUM = 30000;

// Ratio adjustment interval
const ADJUSTMENT_INTERVAL_MS = 5000;

export const aiWorkloadConfig: RateLimiterPreset = {
  models: {
    'anthropic-opus-4.6': {
      tokensPerMinute: ANTHROPIC_TPM,
      requestsPerMinute: ANTHROPIC_RPM,
      pricing: ANTHROPIC_PRICING,
    },
    'openai-gpt-5.2': {
      tokensPerMinute: OPENAI_TPM,
      requestsPerMinute: OPENAI_RPM,
      pricing: OPENAI_PRICING,
    },
  },
  escalationOrder: ['anthropic-opus-4.6', 'openai-gpt-5.2'],
  resourceEstimations: {
    brainstorm: {
      estimatedUsedTokens: BRAINSTORM_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      ratio: { initialValue: BRAINSTORM_RATIO },
      maxWaitMS: {
        'anthropic-opus-4.6': MAX_WAIT_HIGH,
        'openai-gpt-5.2': MAX_WAIT_MEDIUM,
      },
    },
    summarize: {
      estimatedUsedTokens: SUMMARIZE_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      ratio: { initialValue: SUMMARIZE_RATIO },
      maxWaitMS: {
        'anthropic-opus-4.6': MAX_WAIT_HIGH,
        'openai-gpt-5.2': MAX_WAIT_MEDIUM,
      },
    },
    analyzePDF: {
      estimatedUsedTokens: ANALYZE_PDF_TOKENS,
      estimatedNumberOfRequests: ESTIMATED_REQUESTS,
      ratio: { initialValue: ANALYZE_PDF_RATIO, flexible: false },
      maxWaitMS: {
        'anthropic-opus-4.6': MAX_WAIT_HIGH,
        'openai-gpt-5.2': MAX_WAIT_MEDIUM,
      },
    },
  },
  ratioAdjustmentConfig: {
    adjustmentIntervalMs: ADJUSTMENT_INTERVAL_MS,
  },
};
