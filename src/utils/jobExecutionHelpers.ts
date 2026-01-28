/**
 * Helper utilities for job execution in the multi-model rate limiter.
 */
import type {
  ArgsWithoutModelId,
  JobArgs,
  JobCallbackContext,
  JobUsage,
  ModelRateLimitConfig,
  ModelsConfig,
} from '../multiModelTypes.js';

const ZERO = 0;

/** Internal marker class for delegation */
export class DelegationError extends Error {
  public readonly isDelegation = true;
  constructor() {
    super('Delegation requested');
  }
}

export const isDelegationError = (error: unknown): error is DelegationError =>
  error instanceof DelegationError;

/**
 * Build job arguments for when args is undefined.
 * Returns { modelId } typed as a base job args object.
 */
export function buildJobArgs(modelId: string, args: undefined): { modelId: string } & Record<string, unknown>;
/**
 * Build job arguments by merging modelId with user-provided args.
 * When args is provided, merges them with modelId.
 * When args is undefined, returns just { modelId }.
 */
export function buildJobArgs<Args extends ArgsWithoutModelId>(
  modelId: string,
  args: Args | undefined
): JobArgs<Args>;
/**
 * Implementation: merges modelId with args when defined, otherwise returns just modelId.
 */
export function buildJobArgs<Args extends ArgsWithoutModelId>(
  modelId: string,
  args: Args | undefined
): JobArgs<Args> | ({ modelId: string } & Record<string, unknown>) {
  if (args === undefined) {
    // Return object with index signature that satisfies the base JobArgs shape
    const result: { modelId: string } & Record<string, unknown> = { modelId };
    return result;
  }
  return { modelId, ...args };
}

/** Calculate total cost from usage array */
export const calculateTotalCost = (usage: JobUsage): number =>
  usage.reduce((total, entry) => total + entry.cost, ZERO);

/** Build error callback context */
export const buildErrorCallbackContext = (jobId: string, usage: JobUsage): JobCallbackContext => ({
  jobId,
  totalCost: calculateTotalCost(usage),
  usage,
});

/** Calculate the maximum estimated value across all models for a given resource property */
export const calculateMaxEstimatedResource = (
  models: ModelsConfig,
  getter: (config: ModelRateLimitConfig) => number | undefined
): number => {
  let max = ZERO;
  for (const modelConfig of Object.values(models)) {
    const estimated = getter(modelConfig) ?? ZERO;
    max = Math.max(max, estimated);
  }
  return max;
};

/** Wait for any model to have capacity, optionally excluding some models */
export const waitForModelCapacity = async (
  getAvailable: (exclude: ReadonlySet<string>) => string | null,
  excludeModels: ReadonlySet<string>,
  pollIntervalMs: number
): Promise<string> => {
  const { promise, resolve } = Promise.withResolvers<string>();
  const checkCapacity = (): void => {
    const availableModel = getAvailable(excludeModels);
    if (availableModel !== null) {
      resolve(availableModel);
      return;
    }
    setTimeout(checkCapacity, pollIntervalMs);
  };
  checkCapacity();
  return await promise;
};
