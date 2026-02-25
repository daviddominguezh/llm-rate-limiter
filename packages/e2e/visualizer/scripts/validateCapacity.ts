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
import type { CapacityInterval, CapacitySetup, JobTypeMetrics } from '../lib/timeseries/structuredTransform';

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
// Validation 2: granted capacity does not exceed model limits
// =============================================================================

interface ModelResourceTotals {
  tokens: number;
  requests: number;
}

/** For each interval and model, verify total granted resources don't exceed limits */
function validateGrantedCapacity(intervals: CapacityInterval[], setup: CapacitySetup): Violation[] {
  const violations: Violation[] = [];

  intervals.forEach((interval, idx) => {
    const totals = sumCapacityByModel(interval, setup);

    for (const [modelId, total] of Object.entries(totals)) {
      const model = setup.models[modelId];
      if (model === undefined) continue;

      if (model.tokensPerMinute > 0 && total.tokens > model.tokensPerMinute) {
        violations.push({
          interval: idx,
          time: interval.time,
          detail: `${modelId}: granted TPM=${total.tokens.toFixed(1)} > limit=${model.tokensPerMinute}`,
        });
      }

      if (model.requestsPerMinute > 0 && total.requests > model.requestsPerMinute) {
        violations.push({
          interval: idx,
          time: interval.time,
          detail: `${modelId}: granted RPM=${total.requests.toFixed(1)} > limit=${model.requestsPerMinute}`,
        });
      }
    }
  });

  return violations;
}

/** Sum capacity * estimated resources per model across all instances */
function sumCapacityByModel(
  interval: CapacityInterval,
  setup: CapacitySetup
): Record<string, ModelResourceTotals> {
  const totals: Record<string, ModelResourceTotals> = {};
  for (const models of Object.values(interval.instances)) {
    for (const [modelId, jobTypes] of Object.entries(models)) {
      addModelContribution(totals, modelId, jobTypes, setup);
    }
  }
  return totals;
}

/** Accumulate one instance's contribution to a model's resource totals */
function addModelContribution(
  totals: Record<string, ModelResourceTotals>,
  modelId: string,
  jobTypes: Record<string, JobTypeMetrics>,
  setup: CapacitySetup
): void {
  if (totals[modelId] === undefined) {
    totals[modelId] = { tokens: 0, requests: 0 };
  }
  const entry = totals[modelId];
  for (const [jt, metrics] of Object.entries(jobTypes)) {
    const est = setup.jobTypes[jt]?.estimates;
    if (est !== undefined) {
      entry.tokens += metrics.slots * est.estimatedUsedTokens;
      entry.requests += metrics.slots * est.estimatedNumberOfRequests;
    }
  }
}

// =============================================================================
// Runner
// =============================================================================

interface ValidationResult {
  name: string;
  violations: Violation[];
}

function runValidations(intervals: CapacityInterval[], setup: CapacitySetup): ValidationResult[] {
  return [
    { name: 'capacity >= running', violations: validateCapacityGeRunning(intervals) },
    { name: 'granted <= model limit', violations: validateGrantedCapacity(intervals, setup) },
  ];
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
  const { setup, data: intervals } = transformToStructuredData(testData);

  process.stdout.write(`Validating: ${file} (${intervals.length} intervals)\n\n`);

  const results = runValidations(intervals, setup);
  const passed = printResults(results);

  process.stdout.write(passed ? '\nAll validations passed.\n' : '\nSome validations failed.\n');
  process.exit(passed ? 0 : 1);
}

main();
