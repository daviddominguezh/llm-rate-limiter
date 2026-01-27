import { setTimeout as setTimeoutAsync } from 'node:timers/promises';

import { createLLMRateLimiter } from '../multiModelRateLimiter.js';

import type { LLMRateLimiterConfig, LLMRateLimiterInstance, ModelRateLimitConfig, UsageEntry } from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';

// Test constants
export const MOCK_INPUT_TOKENS = 100;
export const MOCK_OUTPUT_TOKENS = 50;
export const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
export const ZERO_CACHED_TOKENS = 0;
export const DEFAULT_REQUEST_COUNT = 1;
export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const FIVE = 5;
export const SIX = 6;
export const NINE = 9;
export const TEN = 10;
export const FIFTY_SEVEN = 57;
export const HUNDRED = 100;
export const THOUSAND = 1000;
export const TEN_THOUSAND = 10000;
export const HUNDRED_THOUSAND = 100000;
export const MILLION = 1000000;
export const TEN_MILLION = 10000000;

// Timing constants
export const LONG_JOB_DELAY_MS = 1000;
export const SEMAPHORE_ACQUIRE_WAIT_MS = 100;
export const SHORT_JOB_DELAY_MS = 50;
export const TIMEOUT_MS = 300;
export const JOB_DELAY_MS = 150;
export const TOLERANCE_MS = 30;

// Memory configuration in KB
export const ESTIMATED_MEMORY_KB = 10240;
export const FREE_MEMORY_RATIO = 0.8;

// Limiter configuration values that allow exactly 1 unit before blocking
export const MEMORY_MAX_CAPACITY_KB = ESTIMATED_MEMORY_KB;
export const CONCURRENCY_LIMIT = 1;
export const RPM_LIMIT = 1;
export const RPD_LIMIT = 1;
export const TPM_LIMIT = MOCK_TOTAL_TOKENS;
export const TPD_LIMIT = MOCK_TOTAL_TOKENS;

// High limits that won't block
export const HIGH_MEMORY_MAX_CAPACITY_KB = ESTIMATED_MEMORY_KB * HUNDRED;
export const HIGH_CONCURRENCY = 100;
export const HIGH_RPM = 1000;
export const HIGH_RPD = 10000;
export const HIGH_TPM = 1000000;
export const HIGH_TPD = 10000000;

// Types for limiter identification
export type LimiterType = 'memory' | 'concurrency' | 'rpm' | 'rpd' | 'tpm' | 'tpd';

export const allLimiters: LimiterType[] = ['memory', 'concurrency', 'rpm', 'rpd', 'tpm', 'tpd'];

// Zero pricing for tests (no cost calculation needed)
export const ZERO_PRICING = { input: ZERO, cached: ZERO, output: ZERO };

// Job ID counter for unique IDs
let jobIdCounter = ZERO;
export const generateJobId = (): string => { jobIdCounter += ONE; return `combo-job-${String(jobIdCounter)}`; };

// Mock job result type
export interface MockJobResult extends InternalJobResult {
  text: string;
}

// Helper to create mock job results
export const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): MockJobResult => ({
  text,
  requestCount,
  usage: { input: MOCK_INPUT_TOKENS, output: MOCK_OUTPUT_TOKENS, cached: ZERO_CACHED_TOKENS },
});

// Helper to create mock usage entry
export const createMockUsage = (modelId: string): UsageEntry => ({
  modelId,
  inputTokens: MOCK_INPUT_TOKENS,
  outputTokens: MOCK_OUTPUT_TOKENS,
  cachedTokens: ZERO_CACHED_TOKENS,
});

const getHighLimitPart = (limiter: LimiterType): Partial<ModelRateLimitConfig> => {
  switch (limiter) {
    case 'memory': return {}; // memory is top-level, not per-model
    case 'concurrency': return { maxConcurrentRequests: HIGH_CONCURRENCY };
    case 'rpm': return { requestsPerMinute: HIGH_RPM };
    case 'rpd': return { requestsPerDay: HIGH_RPD };
    case 'tpm': return { tokensPerMinute: HIGH_TPM };
    case 'tpd': return { tokensPerDay: HIGH_TPD };
  }
};

const getBlockingLimitPart = (limiter: LimiterType): Partial<ModelRateLimitConfig> => {
  switch (limiter) {
    case 'memory': return {}; // memory is top-level, not per-model
    case 'concurrency': return { maxConcurrentRequests: CONCURRENCY_LIMIT };
    case 'rpm': return { requestsPerMinute: RPM_LIMIT };
    case 'rpd': return { requestsPerDay: RPD_LIMIT };
    case 'tpm': return { tokensPerMinute: TPM_LIMIT };
    case 'tpd': return { tokensPerDay: TPD_LIMIT };
  }
};

// Helper to build model config for given limiters with high limits (non-blocking)
const buildModelConfig = (limiters: LimiterType[]): ModelRateLimitConfig => {
  const hasMemory = limiters.includes('memory');
  const hasRequest = limiters.includes('rpm') || limiters.includes('rpd');
  const hasToken = limiters.includes('tpm') || limiters.includes('tpd');

  const limiterParts = limiters.map((l) => getHighLimitPart(l));
  const merged = limiterParts.reduce<Partial<ModelRateLimitConfig>>((acc, part) => ({ ...acc, ...part }), {});

  const resources = {
    ...(hasMemory ? { estimatedUsedMemoryKB: ESTIMATED_MEMORY_KB } : {}),
    ...(hasRequest ? { estimatedNumberOfRequests: DEFAULT_REQUEST_COUNT } : {}),
    ...(hasToken ? { estimatedUsedTokens: MOCK_TOTAL_TOKENS } : {}),
  };

  const base: ModelRateLimitConfig = { ...merged, pricing: ZERO_PRICING };
  return (hasMemory || hasRequest || hasToken)
    ? { ...base, resourcesPerEvent: resources }
    : base;
};

// Helper to build config for given limiters with high limits (non-blocking)
export const buildHighLimitConfig = (limiters: LimiterType[]): LLMRateLimiterConfig => {
  const hasMemory = limiters.includes('memory');
  return {
    ...(hasMemory ? { memory: { freeMemoryRatio: FREE_MEMORY_RATIO }, maxCapacity: HIGH_MEMORY_MAX_CAPACITY_KB } : {}),
    models: { default: buildModelConfig(limiters) },
  };
};

// Helper to build config where one limiter blocks and others have high limits
export const buildConfigWithBlockingLimiter = (
  activeLimiters: LimiterType[],
  blockingLimiter: LimiterType
): LLMRateLimiterConfig => {
  const hasMemory = activeLimiters.includes('memory');
  const isMemoryBlocking = blockingLimiter === 'memory';
  const modelConfig = buildModelConfig(activeLimiters);
  const blocking = getBlockingLimitPart(blockingLimiter);
  const memoryConfig = hasMemory
    ? { memory: { freeMemoryRatio: FREE_MEMORY_RATIO }, maxCapacity: isMemoryBlocking ? MEMORY_MAX_CAPACITY_KB : HIGH_MEMORY_MAX_CAPACITY_KB }
    : {};
  return { ...memoryConfig, models: { default: { ...modelConfig, ...blocking } } };
};

// Helper to get model stats from the limiter
const getDefaultModelStats = (limiter: LLMRateLimiterInstance): ReturnType<LLMRateLimiterInstance['getModelStats']> =>
  limiter.getModelStats('default');

// Helper to check which limiter is blocking
export const getBlockingReason = (
  limiter: LLMRateLimiterInstance,
  activeLimiters: LimiterType[]
): LimiterType | null => {
  const stats = getDefaultModelStats(limiter);
  for (const lt of activeLimiters) {
    if (isLimiterBlocking(stats, lt)) { return lt; }
  }
  return null;
};

const isLimiterBlocking = (
  stats: ReturnType<LLMRateLimiterInstance['getModelStats']>,
  limiter: LimiterType
): boolean => {
  switch (limiter) {
    case 'memory': return stats.memory !== undefined && stats.memory.availableKB < ESTIMATED_MEMORY_KB;
    case 'concurrency': return stats.concurrency !== undefined && stats.concurrency.available <= ZERO;
    case 'rpm': return stats.requestsPerMinute !== undefined && stats.requestsPerMinute.remaining <= ZERO;
    case 'rpd': return stats.requestsPerDay !== undefined && stats.requestsPerDay.remaining <= ZERO;
    case 'tpm': return stats.tokensPerMinute !== undefined && stats.tokensPerMinute.remaining <= ZERO;
    case 'tpd': return stats.tokensPerDay !== undefined && stats.tokensPerDay.remaining <= ZERO;
  }
};

// Generate all combinations of k elements from array
export const combinations = <T>(arr: T[], k: number): T[][] => {
  if (k === ZERO) return [[]];
  const [first] = arr;
  if (first === undefined) return [];
  const rest = arr.slice(ONE);
  const withFirst = combinations(rest, k - ONE).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
};

// Helper function to run blocking test for semaphore-based limiters
export const testSemaphoreBlocker = async (
  limiters: LimiterType[],
  blocker: LimiterType,
  setLimiter: (l: LLMRateLimiterInstance) => void
): Promise<void> => {
  const config = buildConfigWithBlockingLimiter(limiters, blocker);
  const newLimiter = createLLMRateLimiter(config);
  setLimiter(newLimiter);

  expect(newLimiter.hasCapacity()).toBe(true);

  const slowJobPromise = newLimiter.queueJob({
    jobId: generateJobId(),
    job: async ({ modelId }, resolve) => {
      await setTimeoutAsync(LONG_JOB_DELAY_MS);
      resolve(createMockUsage(modelId));
      return createMockJobResult('slow-job');
    },
  });

  await setTimeoutAsync(SEMAPHORE_ACQUIRE_WAIT_MS);

  const stats = getDefaultModelStats(newLimiter);
  if (blocker === 'memory') {
    expect(stats.memory?.activeKB).toBe(ESTIMATED_MEMORY_KB);
    expect(stats.memory?.availableKB).toBe(ZERO);
  } else if (blocker === 'concurrency') {
    expect(stats.concurrency?.active).toBe(ONE);
    expect(stats.concurrency?.available).toBe(ZERO);
  }
  expect(newLimiter.hasCapacity()).toBe(false);
  expect(getBlockingReason(newLimiter, limiters)).toBe(blocker);

  await slowJobPromise;
};

// Helper function to run blocking test for time-window limiters
export const testTimeWindowBlocker = async (
  limiters: LimiterType[],
  blocker: LimiterType,
  setLimiter: (l: LLMRateLimiterInstance) => void
): Promise<void> => {
  const config = buildConfigWithBlockingLimiter(limiters, blocker);
  const newLimiter = createLLMRateLimiter(config);
  setLimiter(newLimiter);

  expect(newLimiter.hasCapacity()).toBe(true);
  await newLimiter.queueJob({
    jobId: generateJobId(),
    job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return createMockJobResult('exhaust-job'); },
  });
  expect(newLimiter.hasCapacity()).toBe(false);
  expect(getBlockingReason(newLimiter, limiters)).toBe(blocker);
};

// Helper to queue a simple job that resolves immediately
export const queueSimpleJob = async <T extends MockJobResult>(
  limiter: LLMRateLimiterInstance,
  result: T
): Promise<T> => {
  const jobResult = await limiter.queueJob({
    jobId: generateJobId(),
    job: ({ modelId }, resolve) => { resolve(createMockUsage(modelId)); return result; },
  });
  return jobResult;
};

// Helper to queue an async job with delay
export const queueDelayedJob = async (
  limiter: LLMRateLimiterInstance,
  text: string,
  delayMs: number
): Promise<MockJobResult> => {
  const jobResult = await limiter.queueJob({
    jobId: generateJobId(),
    job: async ({ modelId }, resolve) => {
      await setTimeoutAsync(delayMs);
      resolve(createMockUsage(modelId));
      return createMockJobResult(text);
    },
  });
  return jobResult;
};

export { createLLMRateLimiter, setTimeoutAsync };
export type { LLMRateLimiterConfig, LLMRateLimiterInstance, MockJobResult as LLMJobResult };
