import type {
  ArgsWithoutModelId,
  JobArgs,
  ModelPricing,
  QueueJobOptions,
  UsageEntry,
} from '../multiModelTypes.js';
import type { InternalJobResult } from '../types.js';

export const MOCK_INPUT_TOKENS = 100;
export const MOCK_OUTPUT_TOKENS = 50;
export const MOCK_TOTAL_TOKENS = MOCK_INPUT_TOKENS + MOCK_OUTPUT_TOKENS;
export const ZERO_CACHED_TOKENS = 0;
export const DEFAULT_REQUEST_COUNT = 1;
export const ZERO = 0;
export const ONE = 1;
export const TWO = 2;
export const THREE = 3;
export const DELAY_MS_SHORT = 10;
export const DELAY_MS_MEDIUM = 50;
export const RPM_LIMIT_LOW = 1;
export const RPM_LIMIT_HIGH = 100;
export const CONCURRENCY_LIMIT = 2;
export const FOUR = 4;
export const FIVE = 5;
export const TEN = 10;

/** Token counts for price tests */
export const TOKENS_100K = 100000;
export const TOKENS_200K = 200000;
export const TOKENS_500K = 500000;
export const TOKENS_1M = 1000000;

/** Default pricing constants for tests (USD per million tokens) */
const PRICE_INPUT = 3.0;
const PRICE_CACHED = 1.5;
const PRICE_OUTPUT = 15.0;
export const DEFAULT_PRICING: ModelPricing = {
  input: PRICE_INPUT,
  cached: PRICE_CACHED,
  output: PRICE_OUTPUT,
};

/** Alternative pricing for tests */
const PRICE_INPUT_ALT = 5.0;
const PRICE_CACHED_ALT = 2.0;
const PRICE_OUTPUT_ALT = 20.0;
export const ALT_PRICING: ModelPricing = {
  input: PRICE_INPUT_ALT,
  cached: PRICE_CACHED_ALT,
  output: PRICE_OUTPUT_ALT,
};

/** Cheap pricing for tests */
const PRICE_INPUT_CHEAP = 0.5;
const PRICE_CACHED_CHEAP = 0.25;
const PRICE_OUTPUT_CHEAP = 1.5;
export const CHEAP_PRICING: ModelPricing = {
  input: PRICE_INPUT_CHEAP,
  cached: PRICE_CACHED_CHEAP,
  output: PRICE_OUTPUT_CHEAP,
};

/** Expensive pricing for tests */
const PRICE_INPUT_EXPENSIVE = 30.0;
const PRICE_CACHED_EXPENSIVE = 15.0;
const PRICE_OUTPUT_EXPENSIVE = 60.0;
export const EXPENSIVE_PRICING: ModelPricing = {
  input: PRICE_INPUT_EXPENSIVE,
  cached: PRICE_CACHED_EXPENSIVE,
  output: PRICE_OUTPUT_EXPENSIVE,
};

let jobIdCounter = ZERO;
/** Generate a unique job ID for tests */
export const generateJobId = (): string => {
  jobIdCounter += ONE;
  return `test-job-${String(jobIdCounter)}`;
};

export interface MockJobResult extends InternalJobResult {
  text: string;
}

export const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): MockJobResult => ({
  text,
  requestCount,
  usage: { input: MOCK_INPUT_TOKENS, output: MOCK_OUTPUT_TOKENS, cached: ZERO_CACHED_TOKENS },
});

/** Create a mock UsageEntry for a given modelId */
export const createMockUsage = (modelId: string): UsageEntry => ({
  modelId,
  inputTokens: MOCK_INPUT_TOKENS,
  outputTokens: MOCK_OUTPUT_TOKENS,
  cachedTokens: ZERO_CACHED_TOKENS,
});

/** Helper to create job options for tests. The job auto-resolves after execution. */
export const createJobOptions = <
  T extends InternalJobResult,
  Args extends ArgsWithoutModelId = ArgsWithoutModelId,
>(
  jobFn: (args: JobArgs<Args>) => T | Promise<T>,
  args?: Args
): QueueJobOptions<T, Args> => ({
  jobId: generateJobId(),
  job: async (jobArgs, resolve): Promise<T> => {
    const result = await jobFn(jobArgs);
    const { modelId } = jobArgs;
    resolve(createMockUsage(modelId));
    return result;
  },
  args,
});

/** Helper to create simple job options that just returns a result. */
export const simpleJob = <T extends InternalJobResult>(result: T): QueueJobOptions<T> => ({
  jobId: generateJobId(),
  job: (jobArgs, resolve): T => {
    const { modelId } = jobArgs;
    resolve(createMockUsage(modelId));
    return result;
  },
});

/** Delay constant for long-running jobs in tests (used to hold resources while checking concurrency) */
export const DELAY_MS_LONG = 100;

/** Type narrowing helper for tests - throws if value is undefined, returns the value otherwise */
export function ensureDefined<T extends object>(
  value: T | undefined | null,
  message = 'Expected value to be defined'
): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}
