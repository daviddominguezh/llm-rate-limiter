import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';

import type { InstanceState } from './stateAggregator.js';
import { type RawTestData, transformTestData } from './testDataTransform.js';
import type { RawEvent, RawEventData } from './testDataTransformTypes.js';
import { sleep } from './testUtils.js';

export type { TestData } from '@llm-rate-limiter/e2e-test-results';

const SLEEP_DURATION_MS = 100;
const SSE_RETRY_DELAY_MS = 2000;
const SSE_DATA_PREFIX = 'data: ';
const SSE_DATA_PREFIX_LENGTH = 6;
const JSON_INDENT_SPACES = 2;
const ZERO_INSTANCES = 0;

/** A single event captured from SSE */
interface CapturedEvent {
  receivedAt: number;
  sourceUrl: string;
  event: unknown;
}

/** A state snapshot at a point in time */
interface RawSnapshot {
  timestamp: number;
  label: string;
  instances: InstanceState[];
}

/** Job sent record */
interface JobSent {
  jobId: string;
  jobType: string;
  sentAt: number;
  targetUrl: string;
}

/** Parsed job event from SSE */
export interface JobEvent {
  type: 'job:queued' | 'job:started' | 'job:completed' | 'job:failed';
  instanceId: string;
  jobId: string;
  jobType: string;
}

/** Event types that trigger snapshots */
const SNAPSHOT_EVENT_TYPES = new Set(['job:queued', 'job:completed', 'job:failed']);

/** Type guard for event data object */
const isEventDataObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Type guard for RawEventData */
const isRawEventData = (value: unknown): value is RawEventData => {
  if (!isEventDataObject(value)) {
    return false;
  }
  const hasType = typeof value.type === 'string';
  const hasInstanceId = typeof value.instanceId === 'string';
  const hasTimestamp = typeof value.timestamp === 'number';
  return hasType && hasInstanceId && hasTimestamp;
};

/** Convert captured events to raw events, filtering invalid entries */
const convertToRawEvents = (events: CapturedEvent[]): RawEvent[] => {
  const rawEvents: RawEvent[] = [];
  for (const captured of events) {
    if (isRawEventData(captured.event)) {
      rawEvents.push({
        receivedAt: captured.receivedAt,
        sourceUrl: captured.sourceUrl,
        event: captured.event,
      });
    }
  }
  return rawEvents;
};

/** Get string from object safely */
const getStringField = (obj: Record<string, unknown>, key: string): string | undefined => {
  const { [key]: value } = obj;
  return typeof value === 'string' ? value : undefined;
};

/** Check if event type is a snapshot event */
const isSnapshotEventType = (eventType: string): eventType is JobEvent['type'] =>
  SNAPSHOT_EVENT_TYPES.has(eventType);

/** Parse a job event from raw SSE data */
const parseJobEvent = (eventData: unknown): JobEvent | null => {
  if (!isEventDataObject(eventData)) {
    return null;
  }

  const eventType = getStringField(eventData, 'type');
  if (eventType === undefined || eventType === '' || !isSnapshotEventType(eventType)) {
    return null;
  }

  const instanceId = getStringField(eventData, 'instanceId');
  if (instanceId === undefined) {
    return null;
  }

  const { payload } = eventData;
  if (!isEventDataObject(payload)) {
    return null;
  }

  const jobId = getStringField(payload, 'jobId');
  const jobType = getStringField(payload, 'jobType');

  if (jobId === undefined || jobType === undefined) {
    return null;
  }

  return {
    type: eventType,
    instanceId,
    jobId,
    jobType,
  };
};

/** Options for TestDataCollector */
export interface TestDataCollectorOptions {
  /** Callback when a job event (queued/completed/failed) is received */
  onJobEvent?: (event: JobEvent) => void;
}

/** SSE chunk processor config */
interface ChunkProcessorConfig {
  chunk: Buffer;
  buffer: string;
  baseUrl: string;
  events: CapturedEvent[];
  onJobEvent?: (event: JobEvent) => void;
}

/**
 * Notify job event callback if valid event
 */
const notifyJobEvent = (callback: ((event: JobEvent) => void) | undefined, eventData: unknown): void => {
  if (callback === undefined) {
    return;
  }
  const jobEvent = parseJobEvent(eventData);
  if (jobEvent !== null) {
    callback(jobEvent);
  }
};

/**
 * Process a single SSE line
 */
const processSSELine = (line: string, config: ChunkProcessorConfig): void => {
  if (!line.startsWith(SSE_DATA_PREFIX)) {
    return;
  }

  try {
    const eventData: unknown = JSON.parse(line.slice(SSE_DATA_PREFIX_LENGTH));
    config.events.push({
      receivedAt: Date.now(),
      sourceUrl: config.baseUrl,
      event: eventData,
    });

    notifyJobEvent(config.onJobEvent, eventData);
  } catch {
    // Ignore parse errors
  }
};

/**
 * Process SSE data chunk and extract events
 */
const processSSEChunk = (config: ChunkProcessorConfig): string => {
  const currentBuffer = config.buffer + config.chunk.toString();

  const lines = currentBuffer.split('\n');
  const remainingBuffer = lines.pop() ?? '';

  for (const line of lines) {
    processSSELine(line, config);
  }

  return remainingBuffer;
};

/** Derive snapshot timestamp from instance timestamps (latest instance time) */
const deriveTimestampFromInstances = (instances: InstanceState[]): number => {
  if (instances.length === ZERO_INSTANCES) {
    return Date.now();
  }
  return Math.max(...instances.map((inst) => inst.lastUpdate));
};

/**
 * Collects all data during an E2E test run.
 */
export class TestDataCollector {
  private readonly instanceUrls: string[];
  private readonly events: CapturedEvent[] = [];
  private readonly snapshots: RawSnapshot[] = [];
  private readonly jobsSent: JobSent[] = [];
  private readonly startTime: number;
  private readonly sseConnections = new Map<string, { close: () => void }>();
  private readonly onJobEvent?: (event: JobEvent) => void;
  private listenersStopped = false;

  constructor(instanceUrls: string[], options: TestDataCollectorOptions = {}) {
    this.instanceUrls = instanceUrls;
    this.startTime = Date.now();
    const { onJobEvent } = options;
    this.onJobEvent = onJobEvent;
  }

  /**
   * Start listening to SSE events from all instances.
   */
  async startEventListeners(): Promise<void> {
    for (const url of this.instanceUrls) {
      this.connectToSSE(url);
    }
    // Give connections time to establish
    await sleep(SLEEP_DURATION_MS);
  }

  private connectToSSE(baseUrl: string): void {
    const urlObj = new URL(`${baseUrl}/api/debug/events`);
    let buffer = '';

    const req = request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        res.on('data', (chunk: Buffer) => {
          buffer = processSSEChunk({
            chunk,
            buffer,
            baseUrl,
            events: this.events,
            onJobEvent: this.onJobEvent,
          });
        });
      }
    );

    req.on('error', () => {
      this.scheduleRetry(baseUrl);
    });

    req.end();

    this.sseConnections.set(baseUrl, {
      close: () => {
        req.destroy();
      },
    });
  }

  /**
   * Schedule SSE reconnection after delay.
   */
  private scheduleRetry(baseUrl: string): void {
    const timer = setTimeout(() => {
      if (!this.listenersStopped) {
        this.connectToSSE(baseUrl);
      }
    }, SSE_RETRY_DELAY_MS);
    timer.unref();
  }

  /**
   * Stop all SSE listeners.
   */
  stopEventListeners(): void {
    this.listenersStopped = true;
    for (const connection of this.sseConnections.values()) {
      connection.close();
    }
    this.sseConnections.clear();
  }

  /**
   * Record a state snapshot.
   */
  addSnapshot(label: string, instances: InstanceState[]): void {
    this.snapshots.push({
      timestamp: deriveTimestampFromInstances(instances),
      label,
      instances,
    });
  }

  /**
   * Record a job that was sent.
   */
  recordJobSent(jobId: string, jobType: string, targetUrl: string): void {
    this.jobsSent.push({
      jobId,
      jobType,
      sentAt: Date.now(),
      targetUrl,
    });
  }

  /**
   * Get all collected data in the improved format.
   */
  getData(): TestData {
    const endTime = Date.now();

    const rawData: RawTestData = {
      startTime: this.startTime,
      endTime,
      instanceUrls: this.instanceUrls,
      events: convertToRawEvents(this.events),
      snapshots: this.snapshots,
      jobsSent: this.jobsSent,
    };

    return transformTestData(rawData);
  }

  /**
   * Save all collected data to a file.
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = this.getData();
    const json = JSON.stringify(data, null, JSON_INDENT_SPACES);
    await writeFile(filePath, json, 'utf-8');
  }
}
