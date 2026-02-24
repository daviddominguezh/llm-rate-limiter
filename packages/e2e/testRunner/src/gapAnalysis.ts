/**
 * CLI script: Find gaps between job executions of the same job type and model.
 *
 * Usage: npx tsx src/gapAnalysis.ts <path-to-test-data.json>
 */
import type { TestData } from '@llm-rate-limiter/e2e-test-results';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import {
  type GapRecord,
  type GroupAnalysis,
  countJobsByGroup,
  discoverGroups,
  findGaps,
  formatSeconds,
  parseGroupKey,
} from './gapAnalysisHelpers.js';

const FIRST_ARG_INDEX = 2;
const MS_TO_SECONDS = 1000;
const GAP_INDEX_OFFSET = 1;
const DECIMAL_PLACES = 1;
const EXIT_FAILURE = 1;
const ZERO = 0;

/** Write a line to stdout */
const writeLine = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** Type guard for TestData */
const isTestData = (value: unknown): value is TestData =>
  typeof value === 'object' && value !== null && 'metadata' in value && 'jobs' in value;

/** Load and parse test data JSON */
const loadTestData = async (filePath: string): Promise<TestData> => {
  const json = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(json);
  if (!isTestData(parsed)) {
    throw new Error('Invalid test data format');
  }
  return parsed;
};

/** Compute the earliest job sent time */
const findFirstJobTime = (testData: TestData): number => {
  const jobs = Object.values(testData.jobs);
  return jobs.reduce((min, j) => (j.sentAt < min ? j.sentAt : min), Infinity);
};

/** Analyze all groups and collect results */
const analyzeAllGroups = (testData: TestData): GroupAnalysis[] => {
  const groups = discoverGroups(testData.snapshots);
  const jobCounts = countJobsByGroup(testData.jobs);
  const firstJobTime = findFirstJobTime(testData);
  const results: GroupAnalysis[] = [];

  for (const key of groups) {
    const { jobType, model } = parseGroupKey(key);
    const gaps = findGaps({
      snapshots: testData.snapshots,
      model,
      jobType,
      startTime: firstJobTime,
      endTime: testData.metadata.endTime,
    });
    const totalGapMs = gaps.reduce((sum, g) => sum + g.durationMs, ZERO);
    const jobCount = jobCounts.get(key) ?? ZERO;
    if (jobCount === ZERO) continue;
    results.push({ jobType, model, jobCount, gaps, totalGapMs });
  }

  return results;
};

/** Format a single gap line */
const formatGapLine = (gap: GapRecord, index: number, baseTime: number): string => {
  const start = formatSeconds(gap.startMs - baseTime);
  const end = formatSeconds(gap.endMs - baseTime);
  const duration = formatSeconds(gap.durationMs);
  return `  Gap ${String(index + GAP_INDEX_OFFSET)}: ${start}s → ${end}s (${duration}s)`;
};

/** Print analysis for a single group */
const printGroup = (group: GroupAnalysis, baseTime: number): void => {
  writeLine(`\n${group.jobType} / ${group.model} (${String(group.jobCount)} jobs)`);

  if (group.gaps.length === ZERO) {
    writeLine('  No gaps found');
    return;
  }

  group.gaps.forEach((gap, i) => {
    writeLine(formatGapLine(gap, i, baseTime));
  });
  writeLine(`  Total gap time: ${formatSeconds(group.totalGapMs)}s`);
};

/** Print summary across all groups */
const printSummary = (results: GroupAnalysis[], testDurationMs: number): void => {
  const totalGaps = results.reduce((sum, r) => sum + r.gaps.length, ZERO);
  const totalIdleMs = results.reduce((sum, r) => sum + r.totalGapMs, ZERO);
  const duration = (testDurationMs / MS_TO_SECONDS).toFixed(DECIMAL_PLACES);

  writeLine(`\nSummary: ${String(totalGaps)} gaps across ${String(results.length)} groups`);
  writeLine(`  Total idle time: ${formatSeconds(totalIdleMs)}s`);
  writeLine(`  Test duration: ${duration}s`);
};

/** Extract CLI argument at a given position */
const getCliArg = (args: string[], index: number): string | undefined => args.at(index);

/** Main entry point */
const main = async (): Promise<void> => {
  const filePath = getCliArg(process.argv, FIRST_ARG_INDEX);
  if (filePath === undefined || filePath === '') {
    process.stderr.write('Usage: npx tsx src/gapAnalysis.ts <path-to-test-data.json>\n');
    process.exit(EXIT_FAILURE);
  }

  const testData = await loadTestData(filePath);
  const baseTime = findFirstJobTime(testData);
  const results = analyzeAllGroups(testData);

  writeLine(`=== Gap Analysis: ${basename(filePath)} ===`);

  for (const group of results) {
    printGroup(group, baseTime);
  }

  printSummary(results, testData.metadata.durationMs);
};

void main();
