/**
 * Logging utilities for stress test metrics.
 */
import type { StressTestMetrics } from './stressTest.helpers.js';
import { JOB_TYPE_NAMES, THOUSAND, TWO, ZERO } from './stressTest.helpers.js';

/**
 * Format and log the metrics summary.
 */
export const logMetricsSummary = (metrics: StressTestMetrics): void => {
  const durationMs = metrics.endTime - metrics.startTime;
  const durationSec = durationMs / THOUSAND;

  const totals = computeTotals(metrics);
  const throughput = totals.started / durationSec;

  logHeader(durationSec, metrics.totalInFlightPeak);
  logJobTypeDetails(metrics);
  logTotals(totals, throughput);
  logViolations(metrics.invariantViolations);
};

interface MetricsTotals {
  started: number;
  completed: number;
  failed: number;
  rejected: number;
}

const computeTotals = (metrics: StressTestMetrics): MetricsTotals => {
  let started = ZERO;
  let completed = ZERO;
  let failed = ZERO;
  let rejected = ZERO;

  for (const jobType of JOB_TYPE_NAMES) {
    const { jobsByType } = metrics;
    const { [jobType]: typeMetrics } = jobsByType;
    if (typeMetrics === undefined) continue;

    started += typeMetrics.started;
    completed += typeMetrics.completed;
    failed += typeMetrics.failed;
    rejected += typeMetrics.rejected;
  }

  return { started, completed, failed, rejected };
};

const logHeader = (durationSec: number, peakConcurrent: number): void => {
  const header = '\n=== Stress Test Results ===';
  const duration = `Duration: ${durationSec.toFixed(TWO)}s`;
  const peak = `Peak concurrent jobs: ${peakConcurrent}`;
  const byType = '\nBy Job Type:';
  process.stdout.write(`${header}\n${duration}\n${peak}\n${byType}\n`);
};

const logJobTypeDetails = (metrics: StressTestMetrics): void => {
  for (const jobType of JOB_TYPE_NAMES) {
    const { jobsByType, peakInFlightByType } = metrics;
    const { [jobType]: typeMetrics } = jobsByType;
    if (typeMetrics === undefined) continue;

    const { [jobType]: peak = ZERO } = peakInFlightByType;
    const line =
      `  ${jobType}: started=${typeMetrics.started}, completed=${typeMetrics.completed}, ` +
      `failed=${typeMetrics.failed}, rejected=${typeMetrics.rejected}, peak=${peak}`;
    process.stdout.write(`${line}\n`);
  }
};

const logTotals = (totals: MetricsTotals, throughput: number): void => {
  const { started, completed, failed, rejected } = totals;
  const totalsLine = `\nTotals: started=${started}, completed=${completed}, failed=${failed}, rejected=${rejected}`;
  const throughputLine = `Throughput: ${throughput.toFixed(TWO)} jobs/sec`;
  process.stdout.write(`${totalsLine}\n${throughputLine}\n`);
};

const MAX_VIOLATIONS_TO_SHOW = 10;

const logViolations = (violations: string[]): void => {
  const countLine = `Invariant violations: ${violations.length}`;
  process.stdout.write(`${countLine}\n`);

  if (violations.length === ZERO) return;

  process.stdout.write('Violations:\n');
  const violationsToShow = violations.slice(ZERO, MAX_VIOLATIONS_TO_SHOW);
  for (const violation of violationsToShow) {
    process.stdout.write(`  - ${violation}\n`);
  }

  const remaining = violations.length - MAX_VIOLATIONS_TO_SHOW;
  if (remaining > ZERO) {
    process.stdout.write(`  ... and ${remaining} more\n`);
  }
};
