/**
 * Per-model-per-jobType slot calculation.
 *
 * Computes how many jobs of a given type can run on a specific model per time window,
 * using the model's per-instance capacity (TPM, RPM, TPD, RPD, totalSlots) and
 * the job type's resource estimates. Takes the minimum across all applicable constraints.
 *
 * Returns both the slot count and the winning dimension's window duration,
 * so callers can distinguish rate-based limits (window counter) from concurrency limits (inFlight).
 */
import type { ModelPoolAllocation } from '../backendTypes.js';
import type { JobTypeResources } from '../jobTypeTypes.js';

const ZERO = 0;
const CONCURRENCY_PER_SLOT = 1;

/** Time window durations for each resource dimension */
export const MINUTE_WINDOW_MS = 60_000;
export const DAY_WINDOW_MS = 86_400_000;
export const CONCURRENCY_WINDOW_MS = 0;

/** Result of per-model-per-jobType slot calculation */
export interface SlotCalculationResult {
  /** Number of slots allocated to this (model, jobType) pair */
  slots: number;
  /** Window duration of the winning (most restrictive) dimension: 0 = concurrency, >0 = rate-based */
  windowMs: number;
}

/** Internal candidate representing one dimension's slot count and window */
interface SlotCandidate {
  slots: number;
  windowMs: number;
}

/** Create a candidate adder bound to a candidates array and ratio */
const createCandidateAdder =
  (
    candidates: SlotCandidate[],
    ratio: number
  ): ((poolValue: number, resourceEstimate: number | undefined, windowMs: number) => void) =>
  (poolValue, resourceEstimate, windowMs) => {
    const estimate = resourceEstimate ?? ZERO;
    if (poolValue > ZERO && estimate > ZERO) {
      candidates.push({ slots: Math.floor((poolValue * ratio) / estimate), windowMs });
    }
  };

/** Check if a candidate is more restrictive than the current minimum */
const isMoreRestrictive = (candidate: SlotCandidate, current: SlotCandidate): boolean =>
  candidate.slots < current.slots ||
  (candidate.slots === current.slots && candidate.windowMs > current.windowMs);

/** Default result when no candidates apply */
const EMPTY_CANDIDATE: SlotCandidate = { slots: ZERO, windowMs: CONCURRENCY_WINDOW_MS };

/** Find the most restrictive candidate (min slots, tie-break on largest windowMs) */
const findMostRestrictive = (candidates: SlotCandidate[]): SlotCandidate => {
  if (candidates.length === ZERO) return EMPTY_CANDIDATE;
  return candidates.reduce((winner, candidate) =>
    isMoreRestrictive(candidate, winner) ? candidate : winner
  );
};

/**
 * Compute allocated slots for a (model, jobType) pair.
 *
 * Uses the model's per-instance capacity limits (TPM, RPM, TPD, RPD) combined with
 * the job type's ratio and resource estimates to calculate the most restrictive slot count.
 *
 * @param pool - Per-instance model pool allocation from Redis
 * @param ratio - Current ratio for this job type (0-1)
 * @param resources - Resource estimates for this job type
 * @param minCapacity - Minimum slots to ensure (prevents starvation)
 * @returns Slot count and the winning dimension's window duration
 */
export const calculateModelJobTypeSlots = (
  pool: ModelPoolAllocation,
  ratio: number,
  resources: JobTypeResources,
  minCapacity: number
): SlotCalculationResult => {
  const candidates: SlotCandidate[] = [];
  const add = createCandidateAdder(candidates, ratio);

  add(pool.tokensPerMinute, resources.estimatedUsedTokens, MINUTE_WINDOW_MS);
  add(pool.requestsPerMinute, resources.estimatedNumberOfRequests, MINUTE_WINDOW_MS);
  add(pool.tokensPerDay, resources.estimatedUsedTokens, DAY_WINDOW_MS);
  add(pool.requestsPerDay, resources.estimatedNumberOfRequests, DAY_WINDOW_MS);
  add(pool.totalSlots, CONCURRENCY_PER_SLOT, CONCURRENCY_WINDOW_MS);

  const winner = findMostRestrictive(candidates);

  return { slots: Math.max(minCapacity, winner.slots), windowMs: winner.windowMs };
};
