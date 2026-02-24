/**
 * Constants, types, and setup helpers for the AI Workload E2E test.
 *
 * Config: ai-workload
 * - 2 models: anthropic-opus-4.6 (TPM=450K, RPM=1K), openai-gpt-5.2 (TPM=1M, RPM=5K)
 * - 3 job types: brainstorm (0.3), summarize (0.2), analyzePDF (0.5 fixed)
 */
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// ---- Ports ----
export const PORT_A = 4001;
export const PORT_B = 4002;
export const BASE_URL_A = `http://localhost:${String(PORT_A)}`;
export const BASE_URL_B = `http://localhost:${String(PORT_B)}`;

// ---- Config ----
export const CONFIG_PRESET: ConfigPresetName = 'ai-workload';

// ---- Models ----
export const MODEL_ANTHROPIC = 'anthropic-opus-4.6';
export const MODEL_OPENAI = 'openai-gpt-5.2';

// ---- Job types ----
export const JOB_BRAINSTORM = 'brainstorm';
export const JOB_SUMMARIZE = 'summarize';
export const JOB_ANALYZE_PDF = 'analyzePDF';

// ---- Expected per-model per-job-type slots (1 instance) ----
// Anthropic: TPM=450K, RPM=1K
export const ANTHROPIC_BRAINSTORM_SLOTS = 13;
export const ANTHROPIC_SUMMARIZE_SLOTS = 3;
export const ANTHROPIC_ANALYZE_PDF_SLOTS = 4;
// OpenAI: TPM=1M, RPM=5K
export const OPENAI_BRAINSTORM_SLOTS = 30;
export const OPENAI_SUMMARIZE_SLOTS = 6;
export const OPENAI_ANALYZE_PDF_SLOTS = 10;

// ---- HTTP status codes ----
export const HTTP_ACCEPTED = 202;
export const HTTP_OK = 200;

// ---- Timing ----
export const ALLOCATION_PROPAGATION_MS = 2000;
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const PHASE_TIMEOUT_MS = 90000;
export const RUNNING_CHECK_DELAY_MS = 3000;
export const RATIO_CHECK_DELAY_MS = 8000;

// ---- Ratio thresholds ----
export const FIXED_RATIO = 0.5;
export const MIN_ADJUSTED_SUMMARIZE_RATIO = 0.35;
export const MAX_ADJUSTED_BRAINSTORM_RATIO = 0.15;

// ---- Types ----

/** Per-model per-jobType info from modelJobTypes */
export interface ModelJobTypeInfo {
  allocated: number;
  inFlight: number;
}

/** Job type state from stats endpoint */
export interface JobTypeState {
  currentRatio: number;
  initialRatio: number;
  flexible: boolean;
  inFlight: number;
  allocatedSlots: number;
  resources: Record<string, unknown>;
}

/** Job type stats from stats endpoint */
export interface JobTypeStats {
  jobTypes: Record<string, JobTypeState>;
  totalSlots: number;
  lastAdjustmentTime: number | null;
  modelJobTypes?: Record<string, Record<string, ModelJobTypeInfo>>;
}

/** Full stats response from GET /api/debug/stats */
export interface StatsResponse {
  instanceId: string;
  timestamp: number;
  stats: {
    models: Record<string, unknown>;
    jobTypes?: JobTypeStats;
  };
}

/** Active job info from GET /api/debug/active-jobs */
export interface ActiveJobInfo {
  jobId: string;
  jobType: string;
  status: 'waiting-for-capacity' | 'waiting-for-model' | 'processing';
}

/** Active jobs response from GET /api/debug/active-jobs */
export interface ActiveJobsResponse {
  instanceId: string;
  timestamp: number;
  activeJobs: ActiveJobInfo[];
  count: number;
}

// ---- Type guards ----

/** Type guard for StatsResponse */
const isStatsResponse = (value: unknown): value is StatsResponse =>
  typeof value === 'object' && value !== null && 'stats' in value && 'instanceId' in value;

/** Type guard for ActiveJobsResponse */
const isActiveJobsResponse = (value: unknown): value is ActiveJobsResponse =>
  typeof value === 'object' && value !== null && 'activeJobs' in value && 'count' in value;

// ---- Setup ----

/** Boot a single instance with ai-workload config */
export const setupSingleInstance = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

// ---- Stats fetching ----

/** Fetch stats from an instance */
export const fetchStats = async (port: number): Promise<StatsResponse> => {
  const url = `http://localhost:${String(port)}/api/debug/stats`;
  const response = await fetch(url);
  const data: unknown = await response.json();
  if (!isStatsResponse(data)) {
    throw new Error('Invalid stats response');
  }
  return data;
};

/** Get job type stats, throwing if missing */
export const getJobTypeStats = (stats: StatsResponse): JobTypeStats => {
  const {
    stats: { jobTypes },
  } = stats;
  if (jobTypes === undefined) {
    throw new Error('No jobTypes in stats response');
  }
  return jobTypes;
};

/** Get per-model per-jobType allocated slots */
export const getModelSlots = (jtStats: JobTypeStats, modelId: string, jobType: string): number => {
  const info = jtStats.modelJobTypes?.[modelId]?.[jobType];
  if (info === undefined) {
    throw new Error(`No modelJobTypes for ${modelId}/${jobType}`);
  }
  return info.allocated;
};

/** Look up a job type state, throwing if not found */
const lookupJobType = (jtStats: JobTypeStats, jobType: string): JobTypeState => {
  const {
    jobTypes: { [jobType]: state },
  } = jtStats;
  if (state === undefined) {
    throw new Error(`Job type "${jobType}" not found`);
  }
  return state;
};

/** Get current ratio for a job type */
export const getJobTypeRatio = (jtStats: JobTypeStats, jobType: string): number => {
  const { currentRatio } = lookupJobType(jtStats, jobType);
  return currentRatio;
};

/** Get in-flight count for a job type */
export const getJobTypeInFlight = (jtStats: JobTypeStats, jobType: string): number => {
  const { inFlight } = lookupJobType(jtStats, jobType);
  return inFlight;
};

// ---- Active jobs ----

/** Fetch active jobs from an instance */
export const fetchActiveJobs = async (port: number): Promise<ActiveJobsResponse> => {
  const url = `http://localhost:${String(port)}/api/debug/active-jobs`;
  const response = await fetch(url);
  const data: unknown = await response.json();
  if (!isActiveJobsResponse(data)) {
    throw new Error('Invalid active jobs response');
  }
  return data;
};

/** Count queued jobs of a specific type */
export const countQueuedByType = (activeJobs: ActiveJobInfo[], jobType: string): number =>
  activeJobs.filter((j) => j.jobType === jobType && j.status !== 'processing').length;

// Re-exports
export { killAllInstances } from '../instanceLifecycle.js';
export { sleep } from '../testUtils.js';
