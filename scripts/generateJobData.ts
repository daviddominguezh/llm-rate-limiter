/**
 * Job Data Generator for E2E Tests
 *
 * Generates a deterministic set of jobs with random durations and scheduled times
 * following a realistic traffic pattern (spikes, valleys, steady rates).
 *
 * Run with: npx tsx scripts/generateJobData.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  JOB_FAILURE_RATE,
  JOB_TYPES,
  type JobTypeName,
  MAX_JOB_DURATION_MS,
  MIN_JOB_DURATION_MS,
  ONE,
  ONE_SECOND_MS,
  OUTPUT_DIR,
  TOTAL_JOBS,
  TRAFFIC_PATTERN,
  type TrafficSegment,
  ZERO,
  generateTimestamp,
  getInputFilename,
} from './e2eScriptConfig.js';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

/** Job data structure */
export interface JobData {
  id: string;
  jobType: JobTypeName;
  durationMs: number;
  scheduledAtMs: number;
  shouldFail: boolean;
}

/** Traffic pattern summary for the job data file */
export interface TrafficPatternSummary {
  spikes: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
  valleys: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
  steady: Array<{ startMs: number; endMs: number; ratePerSec: number }>;
}

/** Complete job data file structure */
export interface JobDataFile {
  generatedAt: string;
  totalJobs: number;
  testDurationMs: number;
  seed: number;
  jobs: JobData[];
  trafficPattern: TrafficPatternSummary;
  jobTypeDistribution: Record<JobTypeName, number>;
}

/**
 * Seeded random number generator for reproducibility.
 * Uses a simple linear congruential generator (LCG).
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Returns a random number between 0 and 1 */
  next(): number {
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    this.seed = (a * this.seed + c) % m;
    return this.seed / m;
  }

  /** Returns a random integer between min (inclusive) and max (inclusive) */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + ONE)) + min;
  }

  /** Returns a random element from an array */
  nextElement<T>(array: readonly T[]): T {
    const index = this.nextInt(ZERO, array.length - ONE);
    return array[index];
  }

  /** Returns true with the given probability (0-1) */
  nextBoolean(probability: number): boolean {
    return this.next() < probability;
  }
}

/** Calculate the number of jobs for each traffic segment */
const calculateJobsPerSegment = (segments: TrafficSegment[]): Map<number, number> => {
  const jobsPerSegment = new Map<number, number>();
  let totalPlannedJobs = ZERO;

  for (let i = ZERO; i < segments.length; i++) {
    const segment = segments[i];
    const durationSec = (segment.endMs - segment.startMs) / ONE_SECOND_MS;
    const jobsInSegment = Math.floor(durationSec * segment.ratePerSec);
    jobsPerSegment.set(i, jobsInSegment);
    totalPlannedJobs += jobsInSegment;
  }

  // Adjust to match exactly TOTAL_JOBS
  const difference = TOTAL_JOBS - totalPlannedJobs;
  if (difference !== ZERO) {
    // Add/remove from the last segment
    const lastSegmentIndex = segments.length - ONE;
    const currentJobs = jobsPerSegment.get(lastSegmentIndex) ?? ZERO;
    jobsPerSegment.set(lastSegmentIndex, Math.max(ZERO, currentJobs + difference));
  }

  return jobsPerSegment;
};

/** Generate scheduled times for jobs within a segment */
const generateScheduledTimes = (segment: TrafficSegment, numJobs: number, random: SeededRandom): number[] => {
  const times: number[] = [];
  const segmentDuration = segment.endMs - segment.startMs;

  for (let i = ZERO; i < numJobs; i++) {
    // Distribute jobs with some randomness within the segment
    const baseTime = segment.startMs + (i / numJobs) * segmentDuration;
    // Add jitter: +/- 500ms
    const jitter = random.nextInt(-500, 500);
    const scheduledTime = Math.max(segment.startMs, Math.min(segment.endMs - ONE, baseTime + jitter));
    times.push(Math.floor(scheduledTime));
  }

  return times.sort((a, b) => a - b);
};

/** Generate all jobs */
const generateJobs = (seed: number): JobData[] => {
  const random = new SeededRandom(seed);
  const jobs: JobData[] = [];
  const jobsPerSegment = calculateJobsPerSegment(TRAFFIC_PATTERN);

  let jobCounter = ZERO;

  for (let segmentIndex = ZERO; segmentIndex < TRAFFIC_PATTERN.length; segmentIndex++) {
    const segment = TRAFFIC_PATTERN[segmentIndex];
    const numJobs = jobsPerSegment.get(segmentIndex) ?? ZERO;
    const scheduledTimes = generateScheduledTimes(segment, numJobs, random);

    for (const scheduledAtMs of scheduledTimes) {
      const job: JobData = {
        id: `job-${String(jobCounter).padStart(5, '0')}`,
        jobType: random.nextElement(JOB_TYPES),
        durationMs: random.nextInt(MIN_JOB_DURATION_MS, MAX_JOB_DURATION_MS),
        scheduledAtMs,
        shouldFail: random.nextBoolean(JOB_FAILURE_RATE),
      };
      jobs.push(job);
      jobCounter++;
    }
  }

  // Sort by scheduled time
  return jobs.sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);
};

/** Build traffic pattern summary */
const buildTrafficPatternSummary = (): TrafficPatternSummary => {
  const summary: TrafficPatternSummary = {
    spikes: [],
    valleys: [],
    steady: [],
  };

  for (const segment of TRAFFIC_PATTERN) {
    const entry = {
      startMs: segment.startMs,
      endMs: segment.endMs,
      ratePerSec: segment.ratePerSec,
    };

    if (segment.type === 'spike') {
      summary.spikes.push(entry);
    } else if (segment.type === 'valley') {
      summary.valleys.push(entry);
    } else {
      summary.steady.push(entry);
    }
  }

  return summary;
};

/** Calculate job type distribution */
const calculateJobTypeDistribution = (jobs: JobData[]): Record<JobTypeName, number> => {
  const distribution: Record<string, number> = {};

  for (const jobType of JOB_TYPES) {
    distribution[jobType] = ZERO;
  }

  for (const job of jobs) {
    distribution[job.jobType]++;
  }

  return distribution as Record<JobTypeName, number>;
};

/** Generate and save job data file */
const generateJobDataFile = (): void => {
  // Use a fixed seed for reproducibility
  const seed = 20240215;
  const timestamp = generateTimestamp();

  console.log('Generating job data...');
  console.log(`  Seed: ${seed}`);
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Total jobs: ${TOTAL_JOBS}`);

  const jobs = generateJobs(seed);
  const testDurationMs = Math.max(...jobs.map((j) => j.scheduledAtMs)) + MAX_JOB_DURATION_MS;

  const jobDataFile: JobDataFile = {
    generatedAt: new Date().toISOString(),
    totalJobs: jobs.length,
    testDurationMs,
    seed,
    jobs,
    trafficPattern: buildTrafficPatternSummary(),
    jobTypeDistribution: calculateJobTypeDistribution(jobs),
  };

  // Write to file
  const outputDirPath = path.resolve(currentDir, OUTPUT_DIR);
  const filename = getInputFilename(timestamp);
  const outputPath = path.join(outputDirPath, filename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(jobDataFile, null, 2));

  console.log(`\nGenerated ${jobs.length} jobs`);
  console.log(`Test duration: ${testDurationMs / ONE_SECOND_MS}s`);
  console.log('\nJob type distribution:');
  for (const [jobType, count] of Object.entries(jobDataFile.jobTypeDistribution)) {
    const percentage = ((count / jobs.length) * 100).toFixed(1);
    console.log(`  ${jobType}: ${count} (${percentage}%)`);
  }

  console.log('\nTraffic pattern:');
  for (const segment of TRAFFIC_PATTERN) {
    const durationSec = (segment.endMs - segment.startMs) / ONE_SECOND_MS;
    console.log(
      `  ${segment.startMs / ONE_SECOND_MS}s-${segment.endMs / ONE_SECOND_MS}s: ` +
        `${segment.ratePerSec} jobs/sec (${segment.type}) = ~${Math.floor(durationSec * segment.ratePerSec)} jobs`
    );
  }

  console.log(`\nSaved to: ${outputPath}`);
};

// Run if executed directly
generateJobDataFile();
