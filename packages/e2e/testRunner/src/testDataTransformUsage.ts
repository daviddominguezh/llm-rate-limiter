/**
 * Usage data extraction helpers for test data transformation
 */
import type { ActualUsageEntry } from '@llm-rate-limiter/e2e-test-results';

const ZERO = 0;

/** Type guard for object values */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parse a single usage entry from raw payload data */
const parseUsageEntry = (entry: unknown): ActualUsageEntry | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const modelId = typeof entry.modelId === 'string' ? entry.modelId : '';
  const inputTokens = typeof entry.inputTokens === 'number' ? entry.inputTokens : ZERO;
  const cachedTokens = typeof entry.cachedTokens === 'number' ? entry.cachedTokens : ZERO;
  const outputTokens = typeof entry.outputTokens === 'number' ? entry.outputTokens : ZERO;
  const requestCount = typeof entry.requestCount === 'number' ? entry.requestCount : ZERO;
  const cost = typeof entry.cost === 'number' ? entry.cost : ZERO;

  return { modelId, inputTokens, cachedTokens, outputTokens, requestCount, cost };
};

/** Filter for non-null entries */
const isNonNull = (entry: ActualUsageEntry | null): entry is ActualUsageEntry => entry !== null;

/**
 * Extract actual usage entries from an event payload.
 * Returns an empty array if the payload has no usage data.
 */
export const getPayloadUsage = (payload: Record<string, unknown>): ActualUsageEntry[] => {
  const { usage } = payload;

  if (!Array.isArray(usage)) {
    return [];
  }

  return usage.map(parseUsageEntry).filter(isNonNull);
};
