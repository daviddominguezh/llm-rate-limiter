import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';

import type { InstanceState } from './stateAggregator.js';
import { type RawTestData, transformTestData } from './testDataTransform.js';

export type { TestData } from '@llm-rate-limiter/e2e-test-results';

const HTTP_OK = 200;

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

/** Parse a job event from raw SSE data */
const parseJobEvent = (eventData: unknown): JobEvent | null => {
  if (typeof eventData !== 'object' || eventData === null) {
    return null;
  }
  const data = eventData as Record<string, unknown>;
  const eventType = data.type as string | undefined;
  if (!eventType || !SNAPSHOT_EVENT_TYPES.has(eventType)) {
    return null;
  }
  const payload = data.payload as Record<string, unknown> | undefined;
  return {
    type: eventType as JobEvent['type'],
    instanceId: data.instanceId as string,
    jobId: payload?.jobId as string,
    jobType: payload?.jobType as string,
  };
};

/** Options for TestDataCollector */
export interface TestDataCollectorOptions {
  /** Callback when a job event (queued/completed/failed) is received */
  onJobEvent?: (event: JobEvent) => void;
}

/**
 * Collects all data during an E2E test run.
 */
export class TestDataCollector {
  private readonly instanceUrls: string[];
  private readonly events: CapturedEvent[] = [];
  private readonly snapshots: RawSnapshot[] = [];
  private readonly jobsSent: JobSent[] = [];
  private readonly startTime: number;
  private readonly sseConnections: Map<string, { close: () => void }> = new Map();
  private readonly onJobEvent?: (event: JobEvent) => void;

  constructor(instanceUrls: string[], options: TestDataCollectorOptions = {}) {
    this.instanceUrls = instanceUrls;
    this.startTime = Date.now();
    this.onJobEvent = options.onJobEvent;
  }

  /**
   * Start listening to SSE events from all instances.
   */
  async startEventListeners(): Promise<void> {
    for (const url of this.instanceUrls) {
      this.connectToSSE(url);
    }
    // Give connections time to establish
    await this.sleep(100);
  }

  private connectToSSE(baseUrl: string): void {
    const urlObj = new URL(`${baseUrl}/api/debug/events`);

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
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();

          // Parse SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.slice(6));
                this.events.push({
                  receivedAt: Date.now(),
                  sourceUrl: baseUrl,
                  event: eventData,
                });

                // Notify callback if this is a job event
                if (this.onJobEvent !== undefined) {
                  const jobEvent = parseJobEvent(eventData);
                  if (jobEvent !== null) {
                    this.onJobEvent(jobEvent);
                  }
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        });
      }
    );

    req.on('error', () => {
      // Ignore connection errors
    });

    req.end();

    this.sseConnections.set(baseUrl, {
      close: () => {
        req.destroy();
      },
    });
  }

  /**
   * Stop all SSE listeners.
   */
  stopEventListeners(): void {
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
      timestamp: Date.now(),
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
      events: this.events as RawTestData['events'],
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
    const json = JSON.stringify(data, null, 2);
    await writeFile(filePath, json, 'utf-8');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
