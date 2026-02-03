/**
 * Shared helpers for distributed multi-instance tests.
 */
import { createLLMRateLimiter } from '../multiModelRateLimiter.js';
import type { BackendConfig, LLMRateLimiterInstance, ModelRateLimitConfig } from '../multiModelTypes.js';

export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const TEN = 10;
export const TWENTY = 20;
export const FIFTY = 50;
export const HUNDRED = 100;
export const MS_PER_MINUTE_PLUS_ONE = 60_001;

const DEFAULT_JOB_TYPE = 'default';

export type InstanceArray = Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>;

export const createModelConfig = (
  _estimatedTokens: number,
  _estimatedRequests: number
): ModelRateLimitConfig => ({
  requestsPerMinute: HUNDRED,
  tokensPerMinute: HUNDRED * TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

export const createLimiterWithBackend = (backend: BackendConfig): LLMRateLimiterInstance =>
  createLLMRateLimiter({
    backend,
    models: { default: createModelConfig(TEN, ONE) },
    resourceEstimationsPerJob: {
      [DEFAULT_JOB_TYPE]: { estimatedNumberOfRequests: ONE, estimatedUsedTokens: TWENTY },
    },
  }) as LLMRateLimiterInstance;

export const cleanupInstances = (instances: InstanceArray): void => {
  for (const { limiter, unsubscribe } of instances) {
    unsubscribe();
    limiter.stop();
  }
};

export const createSimpleJob =
  (tokens: number) =>
  (
    { modelId }: { modelId: string },
    resolve: (r: { modelId: string; inputTokens: number; cachedTokens: number; outputTokens: number }) => void
  ): { requestCount: number; usage: { input: number; output: number; cached: number } } => {
    resolve({ modelId, inputTokens: tokens, cachedTokens: ZERO, outputTokens: ZERO });
    return { requestCount: ONE, usage: { input: tokens, output: ZERO, cached: ZERO } };
  };
