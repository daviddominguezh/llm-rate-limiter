import type { Availability, AvailabilityChangeReason, UsageEntryWithCost } from '@llm-rate-limiter/core';

// =============================================================================
// Historical Job Types
// =============================================================================

/** Status of a historical (completed) job */
export type HistoricalJobStatus = 'completed' | 'failed';

/** Information about a completed or failed job */
export interface HistoricalJob {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Final status of the job */
  status: HistoricalJobStatus;
  /** Model that processed the job (for completed jobs) */
  modelUsed: string;
  /** Timestamp when job was queued (ms since epoch) */
  queuedAt: number;
  /** Timestamp when processing started (ms since epoch) */
  startedAt: number;
  /** Timestamp when job completed or failed (ms since epoch) */
  completedAt: number;
  /** Total cost across all model attempts (USD) */
  totalCost: number;
  /** Error message (for failed jobs) */
  error?: string;
  /** All models that were tried before the final result */
  modelsTried: string[];
}

// =============================================================================
// SSE Event Types
// =============================================================================

/** Types of debug events emitted via SSE */
export type DebugEventType = 'availability' | 'job:queued' | 'job:started' | 'job:completed' | 'job:failed';

/** Base debug event structure */
export interface DebugEvent<T = unknown> {
  /** Type of event */
  type: DebugEventType;
  /** Instance ID that emitted the event */
  instanceId: string;
  /** Timestamp when event occurred (ms since epoch) */
  timestamp: number;
  /** Event-specific payload */
  payload: T;
}

// =============================================================================
// Event Payloads
// =============================================================================

/** Payload for job:queued events */
export interface JobQueuedPayload {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
}

/** Payload for job:started events */
export interface JobStartedPayload {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Model that is processing the job */
  modelId: string;
}

/** Payload for job:completed events */
export interface JobCompletedPayload {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Model that completed the job */
  modelUsed: string;
  /** Total cost across all model attempts (USD) */
  totalCost: number;
  /** Duration from queued to completed (ms) */
  durationMs: number;
  /** Actual usage from all model attempts */
  usage: UsageEntryWithCost[];
}

/** Payload for job:failed events */
export interface JobFailedPayload {
  /** Unique identifier for this job */
  jobId: string;
  /** Job type for capacity allocation */
  jobType: string;
  /** Error message */
  error: string;
  /** All models that were attempted */
  modelsTried: string[];
  /** Total cost across all model attempts (USD) */
  totalCost: number;
  /** Actual usage from all model attempts */
  usage: UsageEntryWithCost[];
}

/** Payload for availability events */
export interface AvailabilityPayload {
  /** Model whose availability changed */
  modelId: string;
  /** Reason for the change */
  reason: AvailabilityChangeReason;
  /** Current availability state */
  availability: Availability;
}

// =============================================================================
// Job History Tracker Types
// =============================================================================

/** Configuration for job history tracker */
export interface JobHistoryTrackerConfig {
  /** Maximum number of jobs to keep in history (default: 1000) */
  maxJobs?: number;
  /** Retention period for completed jobs in ms (default: 300000 = 5 min) */
  retentionMs?: number;
}

/** Parameters for recording a completed job */
export interface RecordCompletedParams {
  jobId: string;
  jobType: string;
  modelUsed: string;
  queuedAt: number;
  startedAt: number;
  totalCost: number;
  modelsTried: string[];
}

/** Parameters for recording a failed job */
export interface RecordFailedParams {
  jobId: string;
  jobType: string;
  error: string;
  queuedAt: number;
  startedAt: number | null;
  totalCost: number;
  modelsTried: string[];
}

// =============================================================================
// SSE Types
// =============================================================================

/** SSE client connection */
export interface SSEClient {
  /** Unique identifier for this client */
  id: string;
  /** Send function to write to the response */
  send: (data: string) => void;
  /** Close function to end the connection */
  close: () => void;
}

/** Callback for job events */
export type JobEventCallback = (event: DebugEvent) => void;
