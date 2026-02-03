/**
 * Improved test data types for verification and visualization.
 */

// =============================================================================
// Metadata
// =============================================================================

export interface TestMetadata {
  startTime: number;
  endTime: number;
  durationMs: number;
  /** Map of instance URL to instance ID */
  instances: Record<string, string>;
}

// =============================================================================
// Job-Centric Data
// =============================================================================

export type JobStatus = 'pending' | 'queued' | 'started' | 'completed' | 'failed';

export interface JobEventRecord {
  type: 'queued' | 'started' | 'completed' | 'failed';
  timestamp: number;
  /** Model ID (for started events) */
  modelId?: string;
  /** Cost (for completed/failed events) */
  cost?: number;
  /** Error message (for failed events) */
  error?: string;
}

export interface JobRecord {
  jobId: string;
  jobType: string;
  /** When the job was sent by the test runner */
  sentAt: number;
  /** Instance that processed this job */
  instanceId: string;
  /** All events for this job in order */
  events: JobEventRecord[];
  /** Final status */
  status: JobStatus;
  /** Model that processed the job (if completed) */
  modelUsed: string | null;
  /** Total cost incurred */
  totalCost: number;
  /** Time from queued to started (ms) */
  queueDurationMs: number | null;
  /** Time from started to completed/failed (ms) */
  processingDurationMs: number | null;
  /** Total time from queued to completed/failed (ms) */
  totalDurationMs: number | null;
}

// =============================================================================
// Timeline
// =============================================================================

export interface TimelineEvent {
  /** Timestamp */
  t: number;
  /** Event type */
  event: string;
  /** Job ID (if job-related) */
  jobId?: string;
  /** Job type (if job-related) */
  jobType?: string;
  /** Instance ID */
  instanceId: string;
  /** Model ID (if applicable) */
  modelId?: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

// =============================================================================
// Compact State Snapshots
// =============================================================================

export interface CompactModelState {
  /** Requests per minute - current usage */
  rpm: number;
  /** Requests per minute - remaining */
  rpmRemaining: number;
  /** Tokens per minute - current usage */
  tpm: number;
  /** Tokens per minute - remaining */
  tpmRemaining: number;
  /** Concurrent requests (for concurrency-limited models) */
  concurrent?: number;
  /** Available concurrent slots */
  concurrentAvailable?: number;
}

export interface CompactJobTypeState {
  /** Current ratio */
  ratio: number;
  /** In-flight jobs */
  inFlight: number;
  /** Allocated slots */
  slots: number;
}

export interface CompactInstanceState {
  /** Number of active jobs */
  activeJobs: number;
  /** Active job IDs */
  activeJobIds: string[];
  /** Model states (only non-zero values) */
  models: Record<string, CompactModelState>;
  /** Job type states (only non-zero inFlight) */
  jobTypes: Record<string, CompactJobTypeState>;
}

export interface StateSnapshot {
  /** Timestamp */
  timestamp: number;
  /** What triggered this snapshot */
  trigger: string;
  /** State per instance */
  instances: Record<string, CompactInstanceState>;
}

// =============================================================================
// Summary
// =============================================================================

export interface JobSummaryByCategory {
  completed: number;
  failed: number;
  total: number;
}

export interface TestSummary {
  totalJobs: number;
  completed: number;
  failed: number;
  /** Average time from queued to completed (ms) */
  avgDurationMs: number | null;
  /** Jobs by instance */
  byInstance: Record<string, JobSummaryByCategory>;
  /** Jobs by job type */
  byJobType: Record<string, JobSummaryByCategory>;
  /** Jobs by model used */
  byModel: Record<string, JobSummaryByCategory>;
}

// =============================================================================
// Complete Test Data
// =============================================================================

export interface TestData {
  metadata: TestMetadata;
  /** Jobs indexed by job ID */
  jobs: Record<string, JobRecord>;
  /** Chronological timeline of all events */
  timeline: TimelineEvent[];
  /** State snapshots */
  snapshots: StateSnapshot[];
  /** Pre-computed summary */
  summary: TestSummary;
}
