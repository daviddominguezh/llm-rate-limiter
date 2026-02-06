/**
 * Initialization helpers for the internal LLM rate limiter.
 * Extracts memory, concurrency, and time-window counter creation.
 */
import type { MemoryLimitConfig } from '../types.js';
import { getAvailableMemoryKB } from './memoryUtils.js';
import { Semaphore } from './semaphore.js';
import { TimeWindowCounter } from './timeWindowCounter.js';

const ZERO = 0;
const DEFAULT_FREE_MEMORY_RATIO = 0.8;
const DEFAULT_RECALCULATION_INTERVAL_MS = 1000;
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

/** Result from memory limiter initialization */
export interface MemoryLimiterResult {
  semaphore: Semaphore;
  intervalId: NodeJS.Timeout;
}

/** Result from time window counter initialization */
export interface TimeWindowCounters {
  rpmCounter: TimeWindowCounter | null;
  rpdCounter: TimeWindowCounter | null;
  tpmCounter: TimeWindowCounter | null;
  tpdCounter: TimeWindowCounter | null;
}

/** Config for time window counter creation */
export interface TimeWindowConfig {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
}

/** Calculate available memory capacity in KB */
export const calculateMemoryCapacityKB = (freeMemoryRatio: number): number =>
  Math.round(getAvailableMemoryKB() * freeMemoryRatio);

/** Create memory limiter (semaphore + recalculation interval) */
export const createMemoryLimiter = (memory: MemoryLimitConfig, label: string): MemoryLimiterResult => {
  const freeMemoryRatio = memory.freeMemoryRatio ?? DEFAULT_FREE_MEMORY_RATIO;
  const recalculationIntervalMs = memory.recalculationIntervalMs ?? DEFAULT_RECALCULATION_INTERVAL_MS;
  const initialCapacity = calculateMemoryCapacityKB(freeMemoryRatio);
  const semaphore = new Semaphore(initialCapacity, `${label}/Memory`);
  const intervalId = setInterval(() => {
    const newCapacity = calculateMemoryCapacityKB(freeMemoryRatio);
    semaphore.setMax(newCapacity);
  }, recalculationIntervalMs);
  return { semaphore, intervalId };
};

/** Create concurrency limiter semaphore */
export const createConcurrencyLimiter = (
  maxConcurrentRequests: number | undefined,
  label: string
): Semaphore | null => {
  if (maxConcurrentRequests === undefined || maxConcurrentRequests <= ZERO) return null;
  return new Semaphore(maxConcurrentRequests, `${label}/Concurrency`);
};

/** Create a single time window counter */
const createCounter = (
  limit: number | undefined,
  windowMs: number,
  label: string,
  name: string
): TimeWindowCounter | null => {
  if (limit === undefined || limit <= ZERO) return null;
  return new TimeWindowCounter(limit, windowMs, `${label}/${name}`);
};

/** Create all time window counters (RPM, RPD, TPM, TPD) */
export const createTimeWindowCounters = (config: TimeWindowConfig, label: string): TimeWindowCounters => ({
  rpmCounter: createCounter(config.requestsPerMinute, MS_PER_MINUTE, label, 'RPM'),
  rpdCounter: createCounter(config.requestsPerDay, MS_PER_DAY, label, 'RPD'),
  tpmCounter: createCounter(config.tokensPerMinute, MS_PER_MINUTE, label, 'TPM'),
  tpdCounter: createCounter(config.tokensPerDay, MS_PER_DAY, label, 'TPD'),
});
