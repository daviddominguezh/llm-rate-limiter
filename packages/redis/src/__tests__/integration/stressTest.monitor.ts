/**
 * Invariant monitoring for stress tests.
 */
import type { RedisBackendInstance } from '../../types.js';
import type { StressTestMetrics } from './stressTest.helpers.js';
import {
  INVARIANT_CHECK_INTERVAL_MS,
  checkInvariants,
  recordViolations,
  updatePeakTracking,
} from './stressTest.helpers.js';

interface InvariantMonitor {
  start: () => void;
  stop: () => void;
}

/**
 * Process the result of an invariant check.
 */
const processInvariantResult = (metrics: StressTestMetrics, backend: RedisBackendInstance): void => {
  checkInvariants(backend)
    .then((result) => {
      recordViolations(metrics, result.violations);
      updatePeakTracking(metrics, result);
    })
    .catch(() => {
      // Ignore check errors during high load
    });
};

/**
 * Create an invariant monitor that periodically checks invariants.
 */
export const createInvariantMonitor = (
  backend: RedisBackendInstance,
  metrics: StressTestMetrics
): InvariantMonitor => {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const start = (): void => {
    if (intervalId !== null) return;

    intervalId = setInterval(() => {
      processInvariantResult(metrics, backend);
    }, INVARIANT_CHECK_INTERVAL_MS);
  };

  const stop = (): void => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  return { start, stop };
};

/**
 * Run a final invariant check after traffic generation completes.
 */
export const runFinalInvariantCheck = async (
  backend: RedisBackendInstance,
  metrics: StressTestMetrics
): Promise<void> => {
  const finalCheck = await checkInvariants(backend);
  recordViolations(metrics, finalCheck.violations);
};
