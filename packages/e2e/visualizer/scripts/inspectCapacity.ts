/**
 * Script to inspect structured capacity data from a test result JSON file.
 *
 * Usage:
 *   npx tsx scripts/inspectCapacity.ts [file] [--sample N] [--json]
 *
 * Examples:
 *   npx tsx scripts/inspectCapacity.ts                          # default: realWorld.json, 10 samples
 *   npx tsx scripts/inspectCapacity.ts realWorld.json --sample 5
 *   npx tsx scripts/inspectCapacity.ts realWorld.json --json    # full JSON output
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import * as fs from 'fs';
import * as path from 'path';

import { transformToStructuredData } from '../lib/timeseries/structuredTransform';
import type { CapacityInterval, StructuredCapacityResult } from '../lib/timeseries/structuredTransform';

const DEFAULT_FILE = 'realWorld.json';
const DEFAULT_SAMPLE_COUNT = 10;
const DATA_DIR = path.resolve(__dirname, '../../testResults/src/data');

/** Parse CLI args */
function parseArgs(): { file: string; sampleCount: number; jsonMode: boolean } {
  const args = process.argv.slice(2);
  let file = DEFAULT_FILE;
  let sampleCount = DEFAULT_SAMPLE_COUNT;
  let jsonMode = false;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--sample' && args[i + 1] !== undefined) {
      sampleCount = parseInt(args[i + 1], 10);
      i += 1;
    } else if (args[i] === '--json') {
      jsonMode = true;
    } else if (!args[i].startsWith('--')) {
      file = args[i];
    }
  }

  return { file, sampleCount, jsonMode };
}

/** Print a single interval in a readable format */
function printInterval(interval: CapacityInterval, index: number): void {
  const header = `--- Interval ${String(index).padStart(3, '0')} | t=${interval.time}s ---`;
  process.stdout.write(`${header}\n`);

  for (const [instId, models] of Object.entries(interval.instances)) {
    for (const [modelId, jobTypes] of Object.entries(models)) {
      for (const [jt, metrics] of Object.entries(jobTypes)) {
        const parts = [
          `run=${String(metrics.running).padStart(2)}`,
          `queue=${String(metrics.queued).padStart(2)}`,
          `cap=${String(metrics.capacity).padStart(2)}`,
        ];
        process.stdout.write(`  ${instId} | ${modelId} | ${jt}: ${parts.join('  ')}\n`);
      }
    }
  }
  process.stdout.write('\n');
}

/** Main */
function main(): void {
  const { file, sampleCount, jsonMode } = parseArgs();
  const filePath = path.resolve(DATA_DIR, file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const testData: TestData = JSON.parse(raw);
  const result: StructuredCapacityResult = transformToStructuredData(testData);
  const { setup, data: intervals } = result;

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  process.stdout.write(`File: ${file}\n`);
  process.stdout.write(`Setup: ${JSON.stringify(setup, null, 2)}\n\n`);
  process.stdout.write(`Total intervals: ${intervals.length}\n`);
  process.stdout.write(`Sampling ${sampleCount} intervals:\n\n`);

  const step = Math.max(1, Math.floor(intervals.length / sampleCount));
  for (let i = 0; i < intervals.length; i += step) {
    printInterval(intervals[i], i);
  }
}

main();
