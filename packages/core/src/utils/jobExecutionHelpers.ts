/**
 * Helper utilities for job execution in the multi-model rate limiter.
 */
import type { MaxWaitMSConfig, ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type { ArgsWithoutModelId, JobArgs, JobCallbackContext, JobUsage } from '../multiModelTypes.js';
import type { ReservationContext } from '../types.js';

const ZERO = 0;
const ONE = 1;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const DEFAULT_BUFFER_SECONDS = 5;

/** Actual usage at time of rejection - preserves token breakdown for accurate cost tracking */
export interface DelegationUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** Default zero usage for delegation */
const ZERO_DELEGATION_USAGE: DelegationUsage = {
  requests: ZERO,
  inputTokens: ZERO,
  outputTokens: ZERO,
  cachedTokens: ZERO,
};

/** Internal marker class for delegation with usage tracking */
export class DelegationError extends Error {
  public readonly isDelegation = true;
  public readonly usage: DelegationUsage;

  constructor(usage: DelegationUsage = ZERO_DELEGATION_USAGE) {
    super('Delegation requested');
    this.usage = usage;
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

/** Convert unknown error to Error object */
export const toErrorObject = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Calculate the maximum estimated value across all items for a given resource property */
export const calculateMaxEstimatedResource = <T>(
  items: Record<string, T>,
  getter: (item: T) => number | undefined
): number => {
  let max = ZERO;
  for (const item of Object.values(items)) {
    const estimated = getter(item) ?? ZERO;
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

/** Wait for job type capacity to become available */
export const waitForJobTypeCapacity = async (
  hasCapacity: () => boolean,
  pollIntervalMs: number
): Promise<unknown> => {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  const checkCapacity = (): void => {
    if (hasCapacity()) {
      resolve(undefined);
      return;
    }
    setTimeout(checkCapacity, pollIntervalMs);
  };
  checkCapacity();
  return await promise;
};

/**
 * Calculate the default maxWaitMS based on time remaining until the next minute boundary.
 * This is optimized for TPM/RPM limits which reset at minute boundaries.
 * @returns milliseconds until next minute + 5 second buffer (range: 5000-65000ms)
 */
export const getDefaultMaxWaitMS = (): number => {
  const now = new Date();
  const secondsToNextMinute = SECONDS_PER_MINUTE - now.getSeconds();
  return (secondsToNextMinute + DEFAULT_BUFFER_SECONDS) * MS_PER_SECOND;
};

/**
 * Get the effective maxWaitMS for a specific job type and model.
 * @param resourceEstimationsPerJob - The resource estimations config
 * @param jobType - The job type ID
 * @param modelId - The model ID
 * @returns The maxWaitMS value (0 for fail-fast, positive for wait time, or default if not specified)
 */
export const getMaxWaitMS = (
  resourceEstimationsPerJob: ResourceEstimationsPerJob | undefined,
  jobType: string,
  modelId: string
): number => {
  if (resourceEstimationsPerJob === undefined) {
    return getDefaultMaxWaitMS();
  }
  const { [jobType]: jobTypeConfig } = resourceEstimationsPerJob;
  if (jobTypeConfig === undefined) {
    return getDefaultMaxWaitMS();
  }
  const maxWaitMSConfig: MaxWaitMSConfig | undefined = jobTypeConfig.maxWaitMS;
  if (maxWaitMSConfig === undefined) {
    return getDefaultMaxWaitMS();
  }
  const { [modelId]: modelMaxWaitMS } = maxWaitMSConfig;
  if (modelMaxWaitMS === undefined) {
    return getDefaultMaxWaitMS();
  }
  return modelMaxWaitMS;
};

/** Parameters for selecting a model with maxWaitMS support */
export interface SelectModelWithWaitParams {
  /** Escalation order of models to try */
  escalationOrder: readonly string[];
  /** Models that have already been tried (will be skipped) */
  triedModels: ReadonlySet<string>;
  /** Function to check if a specific model has capacity */
  hasCapacityForModel: (modelId: string) => boolean;
  /**
   * Function to atomically check and reserve capacity for a model.
   * Returns ReservationContext if capacity was reserved, null otherwise.
   */
  tryReserveForModel: (modelId: string) => ReservationContext | null;
  /** Function to get maxWaitMS for a job type and model */
  getMaxWaitMSForModel: (modelId: string) => number;
  /**
   * Function to wait for capacity using a FIFO queue with timeout.
   * Jobs are served in order when capacity becomes available.
   * Returns ReservationContext if capacity was reserved, null if timed out.
   */
  waitForCapacityWithTimeoutForModel: (
    modelId: string,
    maxWaitMS: number
  ) => Promise<ReservationContext | null>;
  /** Called when starting to wait for a model (for job tracking) */
  onWaitingForModel?: (modelId: string, maxWaitMS: number) => void;
}

/** Result of model selection with waiting */
export interface SelectModelResult {
  /** Selected model ID, or null if all models exhausted */
  modelId: string | null;
  /** Reservation context for the selected model (null if no model selected) */
  reservationContext: ReservationContext | null;
  /** Whether all models were exhausted without finding capacity */
  allModelsExhausted: boolean;
}

/** Try model at given index and recurse to next if no capacity */
const tryModelAtIndex = async (
  params: SelectModelWithWaitParams,
  index: number,
  modelsAttempted: number
): Promise<SelectModelResult> => {
  const {
    escalationOrder,
    triedModels,
    getMaxWaitMSForModel,
    waitForCapacityWithTimeoutForModel,
    onWaitingForModel,
  } = params;

  // Base case: exhausted all models
  if (index >= escalationOrder.length) {
    return {
      modelId: null,
      reservationContext: null,
      allModelsExhausted: modelsAttempted > ZERO || triedModels.size >= escalationOrder.length,
    };
  }

  const { [index]: modelId } = escalationOrder;
  if (modelId === undefined || triedModels.has(modelId)) {
    return await tryModelAtIndex(params, index + ONE, modelsAttempted);
  }

  const maxWaitMS = getMaxWaitMSForModel(modelId);
  onWaitingForModel?.(modelId, maxWaitMS);

  // Wait for capacity using FIFO queue with timeout - returns ReservationContext or null
  const reservationContext = await waitForCapacityWithTimeoutForModel(modelId, maxWaitMS);
  if (reservationContext !== null) {
    return { modelId, reservationContext, allModelsExhausted: false };
  }

  return await tryModelAtIndex(params, index + ONE, modelsAttempted + ONE);
};

/**
 * Select a model with maxWaitMS support.
 * Tries each model in escalation order, waiting up to maxWaitMS for each.
 * Only escalates to the next model after waiting on the current one.
 * @returns The selected model ID, or null if all models exhausted
 */
export const selectModelWithWait = async (params: SelectModelWithWaitParams): Promise<SelectModelResult> => {
  // Try each model in order, waiting on each before moving to the next
  // This ensures we wait for capacity on preferred models before escalating
  return await tryModelAtIndex(params, ZERO, ZERO);
};
