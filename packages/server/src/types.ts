export type { QueueJobRequestBody } from './schemas.js';

export interface QueueJobResponse {
  /** Whether the job was accepted */
  success: boolean;
  /** The job ID */
  jobId: string;
  /** Message about the job status */
  message: string;
}

export interface ErrorResponse {
  /** Whether the request was successful */
  success: false;
  /** Error message */
  error: string;
}

export interface ServerConfig {
  /** Primary port to try (default: 3000) */
  primaryPort?: number;
  /** Fallback port if primary is unavailable (default: 3001) */
  fallbackPort?: number;
  /** Redis URL for rate limiter backend (default: 'redis://localhost:6379') */
  redisUrl?: string;
}

export interface QueuedJob {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  queuedAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}
