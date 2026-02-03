/**
 * Transform raw collected data into the improved structure.
 */
import type {
  CompactInstanceState,
  CompactJobTypeState,
  CompactModelState,
  JobRecord,
  JobSummaryByCategory,
  StateSnapshot,
  TestData,
  TestSummary,
  TimelineEvent,
} from '@llm-rate-limiter/e2e-test-results';

import type { InstanceState } from './stateAggregator.js';

const ZERO = 0;
const ONE = 1;

// =============================================================================
// Raw Data Types (from collector)
// =============================================================================

interface RawEvent {
  receivedAt: number;
  sourceUrl: string;
  event: RawEventData;
}

interface RawEventData {
  type: string;
  instanceId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

interface RawSnapshot {
  timestamp: number;
  label: string;
  instances: InstanceState[];
}

interface RawJobSent {
  jobId: string;
  jobType: string;
  sentAt: number;
  targetUrl: string;
}

export interface RawTestData {
  startTime: number;
  endTime: number;
  instanceUrls: string[];
  events: RawEvent[];
  snapshots: RawSnapshot[];
  jobsSent: RawJobSent[];
}

// =============================================================================
// Transformation Helpers
// =============================================================================

/** Extract instance ID mapping from events */
const buildInstanceMapping = (events: RawEvent[]): Record<string, string> => {
  const mapping: Record<string, string> = {};
  for (const { sourceUrl, event } of events) {
    const data = event as RawEventData;
    if (data.instanceId !== undefined) {
      mapping[sourceUrl] = data.instanceId;
    }
  }
  return mapping;
};

/** Build job records from events */
const buildJobRecords = (
  jobsSent: RawJobSent[],
  events: RawEvent[]
): Record<string, JobRecord> => {
  const jobs: Record<string, JobRecord> = {};

  // Initialize from sent jobs
  for (const sent of jobsSent) {
    jobs[sent.jobId] = {
      jobId: sent.jobId,
      jobType: sent.jobType,
      sentAt: sent.sentAt,
      instanceId: '',
      events: [],
      status: 'pending',
      modelUsed: null,
      totalCost: ZERO,
      queueDurationMs: null,
      processingDurationMs: null,
      totalDurationMs: null,
    };
  }

  // Process events
  for (const { event } of events) {
    const data = event as RawEventData;
    const payload = data.payload ?? {};
    const jobId = payload.jobId as string | undefined;

    if (jobId === undefined || jobs[jobId] === undefined) {
      continue;
    }

    const job = jobs[jobId];
    if (job === undefined) {
      continue;
    }

    switch (data.type) {
      case 'job:queued':
        job.instanceId = data.instanceId;
        job.status = 'queued';
        job.events.push({
          type: 'queued',
          timestamp: data.timestamp,
        });
        break;

      case 'job:started':
        job.status = 'started';
        job.events.push({
          type: 'started',
          timestamp: data.timestamp,
          modelId: payload.modelId as string,
        });
        break;

      case 'job:completed':
        job.status = 'completed';
        job.modelUsed = payload.modelUsed as string;
        job.totalCost = payload.totalCost as number;
        job.events.push({
          type: 'completed',
          timestamp: data.timestamp,
          cost: payload.totalCost as number,
        });
        break;

      case 'job:failed':
        job.status = 'failed';
        job.totalCost = payload.totalCost as number;
        job.events.push({
          type: 'failed',
          timestamp: data.timestamp,
          cost: payload.totalCost as number,
          error: payload.error as string,
        });
        break;
    }
  }

  // Calculate durations
  for (const job of Object.values(jobs)) {
    const queuedEvent = job.events.find((e) => e.type === 'queued');
    const startedEvent = job.events.find((e) => e.type === 'started');
    const endEvent = job.events.find((e) => e.type === 'completed' || e.type === 'failed');

    if (queuedEvent !== undefined && startedEvent !== undefined) {
      job.queueDurationMs = startedEvent.timestamp - queuedEvent.timestamp;
    }
    if (startedEvent !== undefined && endEvent !== undefined) {
      job.processingDurationMs = endEvent.timestamp - startedEvent.timestamp;
    }
    if (queuedEvent !== undefined && endEvent !== undefined) {
      job.totalDurationMs = endEvent.timestamp - queuedEvent.timestamp;
    }
  }

  return jobs;
};

/** Build timeline from events */
const buildTimeline = (events: RawEvent[]): TimelineEvent[] => {
  const timeline: TimelineEvent[] = [];

  for (const { event } of events) {
    const data = event as RawEventData;
    const payload = data.payload ?? {};

    const entry: TimelineEvent = {
      t: data.timestamp,
      event: data.type,
      instanceId: data.instanceId,
    };

    if (payload.jobId !== undefined) {
      entry.jobId = payload.jobId as string;
    }
    if (payload.jobType !== undefined) {
      entry.jobType = payload.jobType as string;
    }
    if (payload.modelId !== undefined) {
      entry.modelId = payload.modelId as string;
    }
    if (payload.modelUsed !== undefined) {
      entry.modelId = payload.modelUsed as string;
    }

    // Add extra data for specific events
    if (data.type === 'job:completed') {
      entry.data = {
        cost: payload.totalCost,
        durationMs: payload.durationMs,
      };
    }
    if (data.type === 'job:failed') {
      entry.data = {
        error: payload.error,
        modelsTried: payload.modelsTried,
      };
    }

    timeline.push(entry);
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.t - b.t);

  return timeline;
};

/** Transform model stats to compact format */
const transformModelState = (
  modelId: string,
  stats: Record<string, unknown>
): CompactModelState | null => {
  const rpm = stats.requestsPerMinute as { current: number; remaining: number } | undefined;
  const tpm = stats.tokensPerMinute as { current: number; remaining: number } | undefined;
  const conc = stats.concurrency as { active: number; available: number } | undefined;

  // Skip if all zeros
  const hasActivity =
    (rpm?.current ?? ZERO) > ZERO ||
    (tpm?.current ?? ZERO) > ZERO ||
    (conc?.active ?? ZERO) > ZERO;

  if (!hasActivity) {
    return null;
  }

  const result: CompactModelState = {
    rpm: rpm?.current ?? ZERO,
    rpmRemaining: rpm?.remaining ?? ZERO,
    tpm: tpm?.current ?? ZERO,
    tpmRemaining: tpm?.remaining ?? ZERO,
  };

  if (conc !== undefined) {
    result.concurrent = conc.active;
    result.concurrentAvailable = conc.available;
  }

  return result;
};

/** Transform job type stats to compact format */
const transformJobTypeState = (
  state: Record<string, unknown>
): CompactJobTypeState | null => {
  const inFlight = state.inFlight as number;

  // Skip if no activity
  if (inFlight === ZERO) {
    return null;
  }

  return {
    ratio: state.currentRatio as number,
    inFlight,
    slots: state.allocatedSlots as number,
  };
};

/** Transform instance state to compact format */
const transformInstanceState = (state: InstanceState): CompactInstanceState => {
  const models: Record<string, CompactModelState> = {};
  const jobTypes: Record<string, CompactJobTypeState> = {};

  // Transform models
  const modelStats = state.stats.models as Record<string, Record<string, unknown>>;
  for (const [modelId, stats] of Object.entries(modelStats)) {
    const compact = transformModelState(modelId, stats);
    if (compact !== null) {
      models[modelId] = compact;
    }
  }

  // Transform job types
  const jobTypeStats = state.stats.jobTypes as { jobTypes: Record<string, Record<string, unknown>> } | undefined;
  if (jobTypeStats?.jobTypes !== undefined) {
    for (const [jobTypeId, jtState] of Object.entries(jobTypeStats.jobTypes)) {
      const compact = transformJobTypeState(jtState);
      if (compact !== null) {
        jobTypes[jobTypeId] = compact;
      }
    }
  }

  return {
    activeJobs: state.activeJobs.length,
    activeJobIds: state.activeJobs.map((j) => j.jobId),
    models,
    jobTypes,
  };
};

/** Transform snapshots to compact format */
const buildSnapshots = (rawSnapshots: RawSnapshot[]): StateSnapshot[] => {
  return rawSnapshots.map((raw) => {
    const instances: Record<string, CompactInstanceState> = {};

    for (const inst of raw.instances) {
      instances[inst.instanceId] = transformInstanceState(inst);
    }

    return {
      timestamp: raw.timestamp,
      trigger: raw.label,
      instances,
    };
  });
};

/** Build summary from job records */
const buildSummary = (jobs: Record<string, JobRecord>): TestSummary => {
  const jobList = Object.values(jobs);

  let completed = ZERO;
  let failed = ZERO;
  let totalDuration = ZERO;
  let durationCount = ZERO;

  const byInstance: Record<string, JobSummaryByCategory> = {};
  const byJobType: Record<string, JobSummaryByCategory> = {};
  const byModel: Record<string, JobSummaryByCategory> = {};

  const ensureCategory = (
    map: Record<string, JobSummaryByCategory>,
    key: string
  ): JobSummaryByCategory => {
    if (map[key] === undefined) {
      map[key] = { completed: ZERO, failed: ZERO, total: ZERO };
    }
    return map[key];
  };

  for (const job of jobList) {
    const isCompleted = job.status === 'completed';
    const isFailed = job.status === 'failed';

    if (isCompleted) {
      completed++;
    }
    if (isFailed) {
      failed++;
    }

    if (job.totalDurationMs !== null) {
      totalDuration += job.totalDurationMs;
      durationCount++;
    }

    // By instance
    if (job.instanceId !== '') {
      const inst = ensureCategory(byInstance, job.instanceId);
      inst.total++;
      if (isCompleted) inst.completed++;
      if (isFailed) inst.failed++;
    }

    // By job type
    const jt = ensureCategory(byJobType, job.jobType);
    jt.total++;
    if (isCompleted) jt.completed++;
    if (isFailed) jt.failed++;

    // By model
    if (job.modelUsed !== null) {
      const model = ensureCategory(byModel, job.modelUsed);
      model.total++;
      if (isCompleted) model.completed++;
      if (isFailed) model.failed++;
    }
  }

  return {
    totalJobs: jobList.length,
    completed,
    failed,
    avgDurationMs: durationCount > ZERO ? totalDuration / durationCount : null,
    byInstance,
    byJobType,
    byModel,
  };
};

// =============================================================================
// Main Transform Function
// =============================================================================

export const transformTestData = (raw: RawTestData): TestData => {
  const instanceMapping = buildInstanceMapping(raw.events);
  const jobs = buildJobRecords(raw.jobsSent, raw.events);
  const timeline = buildTimeline(raw.events);
  const snapshots = buildSnapshots(raw.snapshots);
  const summary = buildSummary(jobs);

  return {
    metadata: {
      startTime: raw.startTime,
      endTime: raw.endTime,
      durationMs: raw.endTime - raw.startTime,
      instances: instanceMapping,
    },
    jobs,
    timeline,
    snapshots,
    summary,
  };
};
