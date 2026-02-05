/**
 * Constants for the Redis distributed backend.
 */

/** Default key prefix for all Redis keys (legacy API) */
export const DEFAULT_KEY_PREFIX = 'llm-rl:';

/** Default key prefix for all Redis keys (new factory API) */
export const DEFAULT_FACTORY_KEY_PREFIX = 'llm-rate-limiter:';

/** Key suffixes for Redis data structures */
export const KEY_SUFFIX_INSTANCES = 'instances';
export const KEY_SUFFIX_ALLOCATIONS = 'allocations';
export const KEY_SUFFIX_CONFIG = 'config';
export const KEY_SUFFIX_CHANNEL = 'channel:allocations';

/** Key suffixes for multi-dimensional allocation config */
export const KEY_SUFFIX_MODEL_CAPACITIES = 'model-capacities';
export const KEY_SUFFIX_JOB_TYPE_RESOURCES = 'jobtype-resources';

/** Default heartbeat interval in milliseconds */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

/** Default instance timeout in milliseconds */
export const DEFAULT_INSTANCE_TIMEOUT_MS = 15000;

/** Default cleanup interval in milliseconds */
export const DEFAULT_CLEANUP_INTERVAL_MS = 10000;

/** Numeric constants */
export const ZERO = 0;
export const ONE = 1;
export const SUCCESS_RESULT = '1';
export const FAILURE_RESULT = '0';
