/**
 * Data collection helpers for mega comprehensive test.
 * Uses TestDataCollector + StateAggregator standalone for visualizer JSON output.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { StateAggregator } from '../stateAggregator.js';
import { TestDataCollector } from '../testDataCollector.js';

const JSON_INDENT_SPACES = 2;

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
}

/** Create data collection context for given instance URLs */
export const createDataCollection = (instanceUrls: string[]): DataCollectionContext => {
  const aggregator = new StateAggregator(instanceUrls);
  const collector = new TestDataCollector(instanceUrls);
  return { collector, aggregator };
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
