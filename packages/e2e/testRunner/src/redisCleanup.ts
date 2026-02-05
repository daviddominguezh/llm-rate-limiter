/**
 * Redis cleanup utilities for E2E tests.
 */
import { Redis } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const ZERO = 0;
const BATCH_SIZE = 100;

/** Default key prefixes used by the rate limiter */
const KEY_PREFIXES = ['llm-rl:', 'llm-rate-limiter:'];

/**
 * Scan result from Redis
 */
interface ScanIterationResult {
  cursor: string;
  keys: string[];
}

/**
 * Execute single scan iteration
 */
const executeScanIteration = async (
  redis: Redis,
  cursor: string,
  prefix: string
): Promise<ScanIterationResult> => {
  const result = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', BATCH_SIZE);
  const [nextCursor, keys] = result;
  return { cursor: nextCursor, keys };
};

/**
 * Delete keys from current scan iteration
 */
const deleteKeysFromIteration = async (redis: Redis, keys: string[]): Promise<number> => {
  if (keys.length > ZERO) {
    await redis.del(...keys);
    return keys.length;
  }
  return ZERO;
};

/**
 * Delete keys recursively using scan
 */
const deleteKeysRecursive = async (
  redis: Redis,
  prefix: string,
  cursor: string,
  deletedSoFar: number
): Promise<number> => {
  const iterResult = await executeScanIteration(redis, cursor, prefix);
  const deletedCount = await deleteKeysFromIteration(redis, iterResult.keys);
  const totalDeleted = deletedSoFar + deletedCount;

  if (iterResult.cursor === '0') {
    return totalDeleted;
  }

  return await deleteKeysRecursive(redis, prefix, iterResult.cursor, totalDeleted);
};

/**
 * Delete keys with a specific prefix from Redis
 */
async function deleteKeysWithPrefix(redis: Redis, prefix: string): Promise<number> {
  return await deleteKeysRecursive(redis, prefix, '0', ZERO);
}

/**
 * Delete keys for a single prefix
 */
const deleteSinglePrefix = async (redis: Redis, prefix: string): Promise<number> => {
  const deletedCount = await deleteKeysWithPrefix(redis, prefix);
  return deletedCount;
};

/**
 * Delete keys for all prefixes using reduce
 */
const deleteAllPrefixes = async (redis: Redis): Promise<number> => {
  const deletePrefix = async (totalSoFar: number, prefix: string): Promise<number> => {
    const count = await deleteSinglePrefix(redis, prefix);
    return totalSoFar + count;
  };

  const total = await KEY_PREFIXES.reduce(async (accPromise, prefix) => {
    const acc = await accPromise;
    return await deletePrefix(acc, prefix);
  }, Promise.resolve(ZERO));

  return total;
};

/**
 * Clean all rate limiter keys from Redis.
 */
export async function cleanRedis(redisUrl = DEFAULT_REDIS_URL): Promise<number> {
  const redis = new Redis(redisUrl);

  try {
    return await deleteAllPrefixes(redis);
  } finally {
    await redis.quit();
  }
}
