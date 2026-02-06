/**
 * Job record transformation helpers
 */
import type { JobEventRecord, JobRecord } from '@llm-rate-limiter/e2e-test-results';

import type { RawEvent, RawEventData, RawJobSent } from './testDataTransformTypes.js';
import { getPayloadUsage } from './testDataTransformUsage.js';

const ZERO = 0;

/**
 * Extract string value from payload field safely
 */
const getPayloadString = (payload: Record<string, unknown>, key: string): string => {
  const { [key]: value } = payload;
  if (typeof value === 'string') {
    return value;
  }
  return '';
};

/**
 * Extract number value from payload field safely
 */
const getPayloadNumber = (payload: Record<string, unknown>, key: string): number => {
  const { [key]: value } = payload;
  if (typeof value === 'number') {
    return value;
  }
  return ZERO;
};

/**
 * Create a fresh job record from sent data
 */
const createJobRecord = (sent: RawJobSent): JobRecord => ({
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
  usage: [],
});

/**
 * Initialize job records from sent jobs
 */
export const initializeJobRecords = (jobsSent: RawJobSent[]): Record<string, JobRecord> => {
  const jobs: Record<string, JobRecord> = {};

  for (const sent of jobsSent) {
    jobs[sent.jobId] = createJobRecord(sent);
  }

  return jobs;
};

/**
 * Create updated job record for queued event
 */
const createQueuedUpdate = (job: JobRecord, data: RawEventData): JobRecord => ({
  ...job,
  instanceId: data.instanceId,
  status: 'queued',
  events: [
    ...job.events,
    {
      type: 'queued',
      timestamp: data.timestamp,
    },
  ],
});

/**
 * Create updated job record for started event
 */
const createStartedUpdate = (
  job: JobRecord,
  data: RawEventData,
  payload: Record<string, unknown>
): JobRecord => ({
  ...job,
  status: 'started',
  events: [
    ...job.events,
    {
      type: 'started',
      timestamp: data.timestamp,
      modelId: getPayloadString(payload, 'modelId'),
    },
  ],
});

/**
 * Create updated job record for completed event
 */
const createCompletedUpdate = (
  job: JobRecord,
  data: RawEventData,
  payload: Record<string, unknown>
): JobRecord => ({
  ...job,
  status: 'completed',
  modelUsed: getPayloadString(payload, 'modelUsed'),
  totalCost: getPayloadNumber(payload, 'totalCost'),
  usage: getPayloadUsage(payload),
  events: [
    ...job.events,
    {
      type: 'completed',
      timestamp: data.timestamp,
      cost: getPayloadNumber(payload, 'totalCost'),
    },
  ],
});

/**
 * Create updated job record for failed event
 */
const createFailedUpdate = (
  job: JobRecord,
  data: RawEventData,
  payload: Record<string, unknown>
): JobRecord => ({
  ...job,
  status: 'failed',
  totalCost: getPayloadNumber(payload, 'totalCost'),
  usage: getPayloadUsage(payload),
  events: [
    ...job.events,
    {
      type: 'failed',
      timestamp: data.timestamp,
      cost: getPayloadNumber(payload, 'totalCost'),
      error: getPayloadString(payload, 'error'),
    },
  ],
});

/**
 * Process a single event and return updated job record
 */
export const processJobEvent = (job: JobRecord, data: RawEventData): JobRecord => {
  const payload = data.payload ?? {};

  switch (data.type) {
    case 'job:queued':
      return createQueuedUpdate(job, data);
    case 'job:started':
      return createStartedUpdate(job, data, payload);
    case 'job:completed':
      return createCompletedUpdate(job, data, payload);
    case 'job:failed':
      return createFailedUpdate(job, data, payload);
    default:
      return job;
  }
};

/**
 * Calculate queue duration from events
 */
const calculateQueueDuration = (events: JobEventRecord[]): number | null => {
  const queuedEvent = events.find((e) => e.type === 'queued');
  const startedEvent = events.find((e) => e.type === 'started');

  if (queuedEvent !== undefined && startedEvent !== undefined) {
    return startedEvent.timestamp - queuedEvent.timestamp;
  }
  return null;
};

/**
 * Calculate processing duration from events
 */
const calculateProcessingDuration = (events: JobEventRecord[]): number | null => {
  const startedEvent = events.find((e) => e.type === 'started');
  const endEvent = events.find((e) => e.type === 'completed' || e.type === 'failed');

  if (startedEvent !== undefined && endEvent !== undefined) {
    return endEvent.timestamp - startedEvent.timestamp;
  }
  return null;
};

/**
 * Calculate total duration from events
 */
const calculateTotalDuration = (events: JobEventRecord[]): number | null => {
  const queuedEvent = events.find((e) => e.type === 'queued');
  const endEvent = events.find((e) => e.type === 'completed' || e.type === 'failed');

  if (queuedEvent !== undefined && endEvent !== undefined) {
    return endEvent.timestamp - queuedEvent.timestamp;
  }
  return null;
};

/**
 * Calculate and apply durations to a job record
 */
const applyDurations = (job: JobRecord): JobRecord => ({
  ...job,
  queueDurationMs: calculateQueueDuration(job.events),
  processingDurationMs: calculateProcessingDuration(job.events),
  totalDurationMs: calculateTotalDuration(job.events),
});

/**
 * Calculate job durations from events
 */
export const calculateJobDurations = (jobs: Record<string, JobRecord>): Record<string, JobRecord> => {
  const result: Record<string, JobRecord> = {};

  for (const [jobId, job] of Object.entries(jobs)) {
    result[jobId] = applyDurations(job);
  }

  return result;
};

/**
 * Extract job ID from event payload safely
 */
const extractJobId = (event: RawEventData): string => {
  const payload = event.payload ?? {};
  const { jobId: jobIdValue } = payload;
  if (typeof jobIdValue === 'string') {
    return jobIdValue;
  }
  return '';
};

/**
 * Build job records from events
 */
export const buildJobRecords = (jobsSent: RawJobSent[], events: RawEvent[]): Record<string, JobRecord> => {
  let jobs = initializeJobRecords(jobsSent);

  for (const rawEvent of events) {
    const { event } = rawEvent;
    const jobId = extractJobId(event);

    if (jobId === '') {
      continue;
    }

    const { [jobId]: existingJob } = jobs;
    if (existingJob === undefined) {
      continue;
    }

    jobs = { ...jobs, [jobId]: processJobEvent(existingJob, event) };
  }

  return calculateJobDurations(jobs);
};
