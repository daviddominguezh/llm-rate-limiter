import { DEFAULT_FALLBACK_PORT, DEFAULT_PRIMARY_PORT, DEFAULT_REDIS_URL } from './constants.js';

const RADIX_DECIMAL = 10;

const parsePort = (value: string | undefined, defaultValue: number): number => {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, RADIX_DECIMAL);
  return isNaN(parsed) ? defaultValue : parsed;
};

export const env = {
  port: parsePort(process.env.PORT, DEFAULT_PRIMARY_PORT),
  fallbackPort: parsePort(process.env.FALLBACK_PORT, DEFAULT_FALLBACK_PORT),
  redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
