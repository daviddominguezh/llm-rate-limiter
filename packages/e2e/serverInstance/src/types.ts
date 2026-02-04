import type { ConfigPresetName } from './rateLimiterConfigs.js';

export type { QueueJobRequestBody } from './schemas.js';

export interface QueueJobResponse {
  jobId: string;
}

export interface ErrorResponse {
  error: string;
}

export interface ServerConfig {
  primaryPort?: number;
  fallbackPort?: number;
  redisUrl?: string;
  /** Configuration preset for the rate limiter */
  configPreset?: ConfigPresetName;
}

export interface QueuedJob {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  queuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}
