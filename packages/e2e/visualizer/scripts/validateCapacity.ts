/**
 * Validate structured capacity data from a test result JSON file.
 *
 * Loads the file, transforms to structured data, then runs validations.
 *
 * Usage:
 *   npx tsx scripts/validateCapacity.ts [file]
 *
 * Examples:
 *   npx tsx scripts/validateCapacity.ts                  # default: realWorld.json
 *   npx tsx scripts/validateCapacity.ts dummy.json
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import * as fs from 'fs';
import * as path from 'path';

import { transformToStructuredData } from '../lib/timeseries/structuredTransform';
import type { CapacityInterval } from '../lib/timeseries/structuredTransform';

const DEFAULT_FILE = 'realWorld.json';
const DATA_DIR = path.resolve(__dirname, '../../testResults/src/data');

interface Violation {
  interval: number;
  time: number;
  detail: string;
}

// =============================================================================
// Validation 1: capacity >= running per entry
// =============================================================================

function validateCapacityGeRunning(intervals: CapacityInterval[]): Violation[] {
  const violations: Violation[] = [];

  intervals.forEach((interval, idx) => {
    for (const [instId, models] of Object.entries(interval.instances)) {
      for (const [modelId, jobTypes] of Object.entries(models)) {
        for (const [jt, m] of Object.entries(jobTypes)) {
          if (m.running > m.capacity) {
            violations.push({
              interval: idx,
              time: interval.time,
              detail: `${instId} | ${modelId} | ${jt}: running=${m.running} > capacity=${m.capacity}`,
            });
          }
        }
      }
    }
  });

  return violations;
}

// =============================================================================
// Runner
// =============================================================================

interface ValidationResult {
  name: string;
  violations: Violation[];
}

function runValidations(intervals: CapacityInterval[]): ValidationResult[] {
  return [{ name: 'capacity >= running', violations: validateCapacityGeRunning(intervals) }];
}

function printResults(results: ValidationResult[]): boolean {
  let allPassed = true;

  for (const { name, violations } of results) {
    if (violations.length === 0) {
      process.stdout.write(`PASS  ${name}\n`);
    } else {
      allPassed = false;
      process.stdout.write(`FAIL  ${name} — ${violations.length} violations:\n`);
      for (const v of violations) {
        process.stdout.write(`  [${v.interval}] t=${v.time}s  ${v.detail}\n`);
      }
    }
  }

  return allPassed;
}

function main(): void {
  const file = process.argv[2] ?? DEFAULT_FILE;
  const filePath = path.resolve(DATA_DIR, file);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const testData: TestData = JSON.parse(raw);
  const { data: intervals } = transformToStructuredData(testData);

  process.stdout.write(`Validating: ${file} (${intervals.length} intervals)\n\n`);

  const results = runValidations(intervals);
  const passed = printResults(results);

  process.stdout.write(passed ? '\nAll validations passed.\n' : '\nSome validations failed.\n');
  process.exit(passed ? 0 : 1);
}

main();
