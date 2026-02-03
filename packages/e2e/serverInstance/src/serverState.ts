/**
 * Mutable server state that can be reset during E2E tests.
 */
import { DebugEventEmitter, JobHistoryTracker } from './debug/index.js';
import { logger } from './logger.js';
import { type ServerRateLimiter, createRateLimiterInstance } from './rateLimiterSetup.js';
import { cleanupRedisKeys } from './redisCleanup.js';

/** Mutable server state */
export interface ServerState {
  rateLimiter: ServerRateLimiter;
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
}

/** Create initial server state */
export const createServerState = (redisUrl: string): ServerState => {
  const jobHistoryTracker = new JobHistoryTracker();
  const rateLimiter = createRateLimiterInstance(redisUrl);
  const eventEmitter = new DebugEventEmitter(rateLimiter.getInstanceId());

  return { rateLimiter, eventEmitter, jobHistoryTracker };
};

/** Result of a reset operation */
export interface ResetResult {
  success: boolean;
  keysDeleted: number;
  newInstanceId: string;
}

/** Options for resetting server state */
export interface ResetOptions {
  /** Whether to clean Redis keys (default: true). Set to false when multiple instances share Redis. */
  cleanRedis?: boolean;
}

/**
 * Reset server state: optionally clean Redis, stop old rate limiter, create new one.
 * Mutates the state object in place.
 */
export const resetServerState = async (
  state: ServerState,
  redisUrl: string,
  options: ResetOptions = {}
): Promise<ResetResult> => {
  const { cleanRedis = true } = options;
  logger.info('Resetting server state...', { cleanRedis });

  // Stop the old rate limiter
  state.rateLimiter.stop();
  logger.info('Old rate limiter stopped');

  // Clean Redis keys only if requested
  let keysDeleted = 0;
  if (cleanRedis) {
    keysDeleted = await cleanupRedisKeys(redisUrl);
    logger.info(`Cleaned ${keysDeleted} Redis keys`);
  }

  // Clear job history
  state.jobHistoryTracker.clear();
  logger.info('Job history cleared');

  // Close old SSE connections
  state.eventEmitter.closeAll();
  logger.info('SSE connections closed');

  // Create new rate limiter
  const newRateLimiter = createRateLimiterInstance(redisUrl);
  await newRateLimiter.start();
  logger.info('New rate limiter started');

  // Create new event emitter with new instance ID
  const newEventEmitter = new DebugEventEmitter(newRateLimiter.getInstanceId());

  // Update state references
  state.rateLimiter = newRateLimiter;
  state.eventEmitter = newEventEmitter;

  logger.info(`Server reset complete. New instance ID: ${newRateLimiter.getInstanceId()}`);

  return {
    success: true,
    keysDeleted,
    newInstanceId: newRateLimiter.getInstanceId(),
  };
};
