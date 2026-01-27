import type { LLMJobResult } from '../types.js';
import type { JobArgs, ArgsWithoutModelId, QueueJobOptions } from '../multiModelTypes.js';

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

export interface MockJobResult extends LLMJobResult {
  text: string;
}

export const createMockJobResult = (text: string, requestCount = DEFAULT_REQUEST_COUNT): MockJobResult => ({
  text,
  requestCount,
  usage: { input: MOCK_INPUT_TOKENS, output: MOCK_OUTPUT_TOKENS, cached: ZERO_CACHED_TOKENS },
});

/** Helper to create job options for tests. The job auto-resolves after execution. */
export const createJobOptions = <T extends LLMJobResult, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  jobFn: (args: JobArgs<Args>) => T | Promise<T>,
  args?: Args
): QueueJobOptions<T, Args> => ({
  job: async (jobArgs, resolve) => {
    const result = await jobFn(jobArgs);
    resolve();
    return result;
  },
  args,
});

/** Helper to create simple job options that just returns a result. */
export const simpleJob = <T extends LLMJobResult>(result: T): QueueJobOptions<T> => ({
  job: (_args, resolve) => { resolve(); return result; },
});
