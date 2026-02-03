/**
 * Redis cleanup utility for server reset.
 */
import { Redis } from 'ioredis';

/** Default key prefixes used by the rate limiter */
const KEY_PREFIXES = ['llm-rl:', 'llm-rate-limiter:'];

const ZERO = 0;
const BATCH_SIZE = 100;

/**
 * Delete keys matching a pattern using SCAN.
 */
const deleteKeysByPattern = async (redis: Redis, pattern: string): Promise<number> => {
  let cursor = '0';
  let totalDeleted = ZERO;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', BATCH_SIZE);
    cursor = nextCursor;

    if (keys.length > ZERO) {
      await redis.del(...keys);
      totalDeleted += keys.length;
    }
  } while (cursor !== '0');

  return totalDeleted;
};

/**
 * Clean all rate limiter keys from Redis.
 */
export const cleanupRedisKeys = async (redisUrl: string): Promise<number> => {
  const redis = new Redis(redisUrl);
  let totalDeleted = ZERO;

  try {
    for (const prefix of KEY_PREFIXES) {
      const deleted = await deleteKeysByPattern(redis, `${prefix}*`);
      totalDeleted += deleted;
    }
  } finally {
    await redis.quit();
  }

  return totalDeleted;
};
