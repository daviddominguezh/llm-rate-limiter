/**
 * Data collection helpers for mega comprehensive test.
 * Uses TestDataCollector + StateAggregator standalone for visualizer JSON output.
 *
 * Matches the suiteRunner.ts pattern:
 * - Event-triggered snapshots on job:queued/completed/failed
 * - Periodic snapshots every SNAPSHOT_INTERVAL_MS
 * - Proper collector.recordJobSent() via setActiveCollector in job helpers
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StateAggregator } from '../stateAggregator.js';
import { type JobEvent, TestDataCollector } from '../testDataCollector.js';

const JSON_INDENT_SPACES = 2;
const SNAPSHOT_INTERVAL_MS = 500;

/** Get the output directory for test result data */
const getOutputDir = (): string => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, '../../../testResults/src/data');
};

/** Build output file path for a suite name */
const getOutputPath = (suiteName: string): string => join(getOutputDir(), `${suiteName}.json`);

/** Data collection context for a test run */
export interface DataCollectionContext {
  collector: TestDataCollector;
  aggregator: StateAggregator;
  stopPeriodicSnapshots: () => void;
}

/** Create event-triggered snapshot handler (like suiteRunner's createCollector) */
const createEventSnapshotHandler =
  (
    aggregator: StateAggregator,
    collectorRef: { current: TestDataCollector | null }
  ): ((event: JobEvent) => void) =>
  (event: JobEvent): void => {
    if (collectorRef.current === null) {
      return;
    }
    const { current: collector } = collectorRef;
    aggregator
      .fetchState()
      .then((states) => {
        collector.addSnapshot(`${event.type}:${event.jobId}`, states);
      })
      .catch(() => {
        // Ignore snapshot errors during rapid event processing
      });
  };

/** Start periodic snapshot polling, returns a stop function */
const startPeriodicSnapshots = (
  aggregator: StateAggregator,
  collector: TestDataCollector,
  intervalMs: number
): { stop: () => void } => {
  const intervalId = setInterval(() => {
    aggregator
      .fetchState()
      .then((states) => {
        collector.addSnapshot('periodic', states);
      })
      .catch(() => {
        // Ignore periodic snapshot errors
      });
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
};

/** Create data collection context with event-triggered + periodic snapshots */
export const createDataCollection = (instanceUrls: string[]): DataCollectionContext => {
  const aggregator = new StateAggregator(instanceUrls);
  const collectorRef: { current: TestDataCollector | null } = { current: null };
  const onJobEvent = createEventSnapshotHandler(aggregator, collectorRef);
  const collector = new TestDataCollector(instanceUrls, { onJobEvent });
  collectorRef.current = collector;

  const periodic = startPeriodicSnapshots(aggregator, collector, SNAPSHOT_INTERVAL_MS);

  return { collector, aggregator, stopPeriodicSnapshots: periodic.stop };
};

/** Start data collection: SSE listeners + initial snapshot */
export const startDataCollection = async (ctx: DataCollectionContext): Promise<void> => {
  await ctx.collector.startEventListeners();
  const states = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot('initial', states);
};

/** Add a labeled snapshot to the collector */
export const addSnapshot = async (ctx: DataCollectionContext, label: string): Promise<void> => {
  const states = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot(label, states);
};

/** Stop collection and save to JSON file */
export const saveAndStopCollection = async (ctx: DataCollectionContext, suiteName: string): Promise<void> => {
  ctx.stopPeriodicSnapshots();

  const finalStates = await ctx.aggregator.fetchState();
  ctx.collector.addSnapshot('final', finalStates);
  ctx.collector.stopEventListeners();

  const filePath = getOutputPath(suiteName);
  await mkdir(dirname(filePath), { recursive: true });

  const data = ctx.collector.getData();
  const json = JSON.stringify(data, null, JSON_INDENT_SPACES);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, json, 'utf-8');
};
