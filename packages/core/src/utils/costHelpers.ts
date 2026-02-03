/**
 * Cost calculation helpers for the LLM Rate Limiter.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  Availability,
  DistributedAvailability,
  JobUsage,
  ModelRateLimitConfig,
  RelativeAvailabilityAdjustment,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';

const ZERO = 0;
const TOKENS_PER_MILLION = 1_000_000;

/** Calculate cost for a usage entry */
export const calculateCost = (
  models: Record<string, ModelRateLimitConfig>,
  modelId: string,
  usage: UsageEntry
): number => {
  const defaultPricing = { input: ZERO, cached: ZERO, output: ZERO };
  const { input, cached, output } = models[modelId]?.pricing ?? defaultPricing;
  return (
    (usage.inputTokens * input + usage.cachedTokens * cached + usage.outputTokens * output) /
    TOKENS_PER_MILLION
  );
};

/** Add usage entry with calculated cost */
export const addUsageWithCost = (
  models: Record<string, ModelRateLimitConfig>,
  ctx: { usage: JobUsage },
  modelId: string,
  usage: UsageEntry
): void => {
  ctx.usage.push({ ...usage, cost: calculateCost(models, modelId, usage) });
};

/** Calculate job adjustment for availability tracking */
export const calculateJobAdjustment = (
  resourcesPerJob: ResourceEstimationsPerJob,
  jobType: string,
  result: InternalJobResult
): RelativeAvailabilityAdjustment | null => {
  const resources = resourcesPerJob[jobType];
  const tokenDiff = result.usage.input + result.usage.output - (resources?.estimatedUsedTokens ?? ZERO);
  const requestDiff = result.requestCount - (resources?.estimatedNumberOfRequests ?? ZERO);
  if (tokenDiff === ZERO && requestDiff === ZERO) {
    return null;
  }
  return {
    tokensPerMinute: tokenDiff,
    tokensPerDay: tokenDiff,
    requestsPerMinute: requestDiff,
    requestsPerDay: requestDiff,
    memoryKB: ZERO,
    concurrentRequests: ZERO,
  };
};

/** Convert distributed availability to full availability */
export const toFullAvailability = (availability: DistributedAvailability): Availability => ({
  slots: availability.slots,
  tokensPerMinute: availability.tokensPerMinute ?? null,
  tokensPerDay: availability.tokensPerDay ?? null,
  requestsPerMinute: availability.requestsPerMinute ?? null,
  requestsPerDay: availability.requestsPerDay ?? null,
  concurrentRequests: null,
  memoryKB: null,
});
