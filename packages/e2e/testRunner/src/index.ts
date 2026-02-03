import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resetInstance } from './resetInstance.js';
import { StateAggregator } from './stateAggregator.js';
import { TestDataCollector } from './testDataCollector.js';
import { log, logError, sendJob, sleep, summarizeResults } from './testUtils.js';

const PROXY_URL = 'http://localhost:3000';
const INSTANCE_URLS = ['http://localhost:3001', 'http://localhost:3002'];
const NUM_JOBS = 10;
const EXIT_FAILURE = 1;
const ZERO = 0;

// Output file for test data - save to shared testResults package
const getCurrentDir = (): string => dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(getCurrentDir(), '../../testResults/src/data');
const getOutputFilePath = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(OUTPUT_DIR, `test-run-${timestamp}.json`);
};

const JOB_TYPES = ['summary', 'VacationPlanning', 'ImageCreation', 'BudgetCalculation', 'WeatherForecast'];

const getRandomJobType = (): string => {
  const randomIndex = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[randomIndex] ?? 'summary';
};

const resetAllInstances = async (): Promise<void> => {
  log('Resetting all server instances...');

  let isFirst = true;
  for (const url of INSTANCE_URLS) {
    // Only clean Redis on the first instance to avoid wiping other instances' registrations
    const result = await resetInstance(url, { cleanRedis: isFirst });
    if (result.success) {
      const cleanMsg = isFirst ? `${result.keysDeleted} keys deleted, ` : '';
      log(`  - ${url}: Reset OK (${cleanMsg}new ID: ${result.newInstanceId})`);
    } else {
      logError(`  - ${url}: Reset FAILED - ${result.error}`);
    }
    isFirst = false;
  }
};

const runTests = async (): Promise<void> => {
  log('=== E2E Test Runner ===');
  log(`Proxy URL: ${PROXY_URL}`);
  log(`Instance URLs: ${INSTANCE_URLS.join(', ')}`);
  log('');

  // Reset all instances (cleans Redis and creates new rate limiters)
  await resetAllInstances();
  log('');

  // Initialize collectors
  const aggregator = new StateAggregator(INSTANCE_URLS);

  // Create collector with callback to take snapshots on job events
  const collector = new TestDataCollector(INSTANCE_URLS, {
    onJobEvent: (event) => {
      // Take a snapshot asynchronously when a job event occurs
      aggregator
        .fetchState()
        .then((states) => {
          collector.addSnapshot(`${event.type}:${event.jobId}`, states);
        })
        .catch(() => {
          // Ignore snapshot errors
        });
    },
  });

  // Start listening to SSE events
  log('Starting event listeners...');
  await collector.startEventListeners();

  // Take initial snapshot
  log('Taking initial state snapshot...');
  const initialStates = await aggregator.fetchState();
  collector.addSnapshot('initial', initialStates);

  log(`Found ${initialStates.length} instances:`);
  for (const state of initialStates) {
    log(`  - ${state.instanceId}: ${state.activeJobs.length} active jobs`);
  }

  // Send jobs via proxy
  log('');
  log(`=== Sending ${NUM_JOBS} Jobs via Proxy ===`);

  const jobs = [];
  for (let i = ZERO; i < NUM_JOBS; i++) {
    jobs.push({
      jobId: `test-job-${Date.now()}-${i}`,
      jobType: getRandomJobType(),
      payload: { testData: `Test payload for job ${i}` },
    });
  }

  const results = [];
  for (const job of jobs) {
    // Record job being sent
    collector.recordJobSent(job.jobId, job.jobType, PROXY_URL);

    const result = await sendJob(PROXY_URL, job);
    results.push(result);

    if (result.success) {
      log(`[OK] Job ${result.jobId} queued`);
    } else {
      logError(`[FAIL] Job ${result.jobId}: ${result.error}`);
    }
  }

  // Take snapshot after sending jobs
  await sleep(200);
  const afterSendStates = await aggregator.fetchState();
  collector.addSnapshot('after-sending-jobs', afterSendStates);

  log('');
  const summary = summarizeResults(results);
  log(`Sent: ${summary.total} | Successful: ${summary.successful} | Failed: ${summary.failed}`);

  // Wait for jobs to complete
  log('');
  log('Waiting for jobs to complete...');
  try {
    await aggregator.waitForNoActiveJobs({ timeoutMs: 30000 });
    log('All jobs completed!');
  } catch (error) {
    logError(`Timeout: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Take final snapshot
  const finalStates = await aggregator.fetchState();
  collector.addSnapshot('final', finalStates);

  // Stop event listeners
  collector.stopEventListeners();

  // Get collected data summary
  const data = collector.getData();
  log('');
  log('=== Data Collection Summary ===');
  log(`Duration: ${data.metadata.durationMs}ms`);
  log(`Timeline events: ${data.timeline.length}`);
  log(`Snapshots taken: ${data.snapshots.length}`);
  log(`Jobs: ${data.summary.totalJobs} total, ${data.summary.completed} completed, ${data.summary.failed} failed`);
  if (data.summary.avgDurationMs !== null) {
    log(`Avg job duration: ${data.summary.avgDurationMs.toFixed(1)}ms`);
  }

  // Log event breakdown from timeline
  const eventTypes = new Map<string, number>();
  for (const event of data.timeline) {
    eventTypes.set(event.event, (eventTypes.get(event.event) ?? 0) + 1);
  }
  log('Event breakdown:');
  for (const [type, count] of eventTypes) {
    log(`  - ${type}: ${count}`);
  }

  // Log by instance
  log('By instance:');
  for (const [instanceId, stats] of Object.entries(data.summary.byInstance)) {
    log(`  - ${instanceId}: ${stats.completed} completed, ${stats.failed} failed`);
  }

  // Log by model
  log('By model:');
  for (const [modelId, stats] of Object.entries(data.summary.byModel)) {
    log(`  - ${modelId}: ${stats.completed} completed, ${stats.failed} failed`);
  }

  // Save to file
  const outputPath = getOutputFilePath();
  await mkdir(dirname(outputPath), { recursive: true });
  await collector.saveToFile(outputPath);
  log('');
  log(`Test data saved to: ${outputPath}`);

  log('');
  log('=== Test Complete ===');
};

runTests().catch((error: unknown) => {
  logError(`Test runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_FAILURE);
});
