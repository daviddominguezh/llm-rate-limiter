/**
 * Shared helpers for backend tests.
 */
import type {
  BackendAcquireContext,
  BackendReleaseContext,
  ModelRateLimitConfig,
} from '../multiModelTypes.js';

export const ZERO = 0;
export const ONE = 1;
export const TEN = 10;
export const HUNDRED = 100;
export const HALF = 0.5;

export const createDefaultConfig = (): ModelRateLimitConfig => ({
  requestsPerMinute: TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

export const createConfigWithMemory = (): ModelRateLimitConfig => ({
  requestsPerMinute: TEN,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

export const createAcquireTrue =
  (calls: BackendAcquireContext[]): ((ctx: BackendAcquireContext) => Promise<boolean>) =>
  async (ctx): Promise<boolean> => {
    calls.push(ctx);
    return await Promise.resolve(true);
  };

export const createReleasePush =
  (calls: BackendReleaseContext[]): ((ctx: BackendReleaseContext) => Promise<void>) =>
  async (ctx): Promise<void> => {
    calls.push(ctx);
    await Promise.resolve();
  };

export const createAcquireTrueSimple =
  (): ((ctx: BackendAcquireContext) => Promise<boolean>) => async (): Promise<boolean> =>
    await Promise.resolve(true);

export const createReleaseSimple =
  (): ((ctx: BackendReleaseContext) => Promise<void>) => async (): Promise<void> => {
    await Promise.resolve();
  };

export const createAcquireFalse =
  (): ((ctx: BackendAcquireContext) => Promise<boolean>) => async (): Promise<boolean> =>
    await Promise.resolve(false);

export const createAcquireConditional =
  (calls: string[], rejectModel: string): ((ctx: BackendAcquireContext) => Promise<boolean>) =>
  async (ctx): Promise<boolean> => {
    calls.push(ctx.modelId);
    return await Promise.resolve(ctx.modelId !== rejectModel);
  };

/** Job result type for test jobs */
export interface TestJobResult {
  requestCount: number;
  usage: { input: number; output: number; cached: number };
  [key: string]: unknown;
}

/** Usage result type for resolve callback */
export interface TestUsageResult {
  modelId: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** Resolve function type */
export type ResolveFunction = (result: TestUsageResult) => void;

/** Creates a simple synchronous job for testing */
export const createSimpleJob =
  (inputTokens: number, outputTokens: number = inputTokens) =>
  (ctx: { modelId: string }, resolve: ResolveFunction): TestJobResult => {
    resolve({ modelId: ctx.modelId, inputTokens, cachedTokens: ZERO, outputTokens });
    return { requestCount: ONE, usage: { input: inputTokens, output: outputTokens, cached: ZERO } };
  };

/** Creates a model config with only requests per minute */
export const createRequestOnlyConfig = (requests: number): ModelRateLimitConfig => ({
  requestsPerMinute: requests,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Creates a model config with only tokens per minute */
export const createTokenOnlyConfig = (tokens: number, _estimatedTokens: number): ModelRateLimitConfig => ({
  tokensPerMinute: tokens,
  pricing: { input: ZERO, cached: ZERO, output: ZERO },
});

/** Creates a two-model config (both with same settings) */
export const createTwoModelConfig = (
  tokens: number,
  estimatedTokens: number
): Record<string, ModelRateLimitConfig> => ({
  modelA: createTokenOnlyConfig(tokens, estimatedTokens),
  modelB: createTokenOnlyConfig(tokens, estimatedTokens),
});
