import { request } from 'node:http';
import { promisify } from 'node:util';

const PROXY_URL = 'http://localhost:3000';
const API_PATH = '/api/queue-job';
const NUM_JOBS = 10;
const HTTP_ACCEPTED = 202;
const INCREMENT = 1;
const EXIT_FAILURE = 1;

interface QueueJobRequest {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
}

interface QueueJobResponse {
  jobId: string;
}

interface JobResult {
  success: boolean;
  jobId: string;
  error?: string;
}

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const isQueueJobResponse = (value: unknown): value is QueueJobResponse =>
  typeof value === 'object' &&
  value !== null &&
  'jobId' in value &&
  typeof (value as { jobId: unknown }).jobId === 'string';

const sendJobCallback = (
  job: QueueJobRequest,
  callback: (error: Error | null, response: QueueJobResponse | null) => void
): void => {
  const data = JSON.stringify(job);

  const req = request(
    `${PROXY_URL}${API_PATH}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    },
    (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        if (res.statusCode === HTTP_ACCEPTED) {
          const parsed: unknown = JSON.parse(body);
          if (isQueueJobResponse(parsed)) {
            callback(null, parsed);
          } else {
            callback(new Error('Invalid response format'), null);
          }
        } else {
          callback(new Error(`Request failed with status ${res.statusCode}: ${body}`), null);
        }
      });
    }
  );

  req.on('error', (error) => {
    callback(error, null);
  });
  req.write(data);
  req.end();
};

const sendJobPromisified = promisify(sendJobCallback);

const sendJob = async (job: QueueJobRequest): Promise<QueueJobResponse> => {
  const response = await sendJobPromisified(job);
  if (response === null) {
    throw new Error('No response received');
  }
  return response;
};

const JOB_TYPES = ['summary', 'VacationPlanning', 'ImageCreation', 'BudgetCalculation', 'WeatherForecast'];

const getRandomJobType = (): string => {
  const randomIndex = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[randomIndex] ?? 'default';
};

const createJob = (index: number): QueueJobRequest => ({
  jobId: `test-job-${Date.now()}-${index}`,
  jobType: getRandomJobType(),
  payload: {
    testData: `Test payload for job ${index}`,
    timestamp: new Date().toISOString(),
  },
});

const processJob = async (job: QueueJobRequest): Promise<JobResult> => {
  try {
    const response = await sendJob(job);
    log(`[OK] Job ${response.jobId} queued successfully`);
    return { success: true, jobId: job.jobId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError(`[FAIL] Job ${job.jobId} failed: ${errorMessage}`);
    return { success: false, jobId: job.jobId, error: errorMessage };
  }
};

const runTests = async (): Promise<void> => {
  log(`Sending ${NUM_JOBS} jobs to ${PROXY_URL}${API_PATH}...`);
  log('');

  const jobs: QueueJobRequest[] = [];
  for (let i = 0; i < NUM_JOBS; i += INCREMENT) {
    jobs.push(createJob(i));
  }

  const results = await Promise.all(jobs.map(processJob));

  log('');
  log('=== Test Summary ===');
  const { length: successful } = results.filter((r) => r.success);
  const { length: failed } = results.filter((r) => !r.success);
  log(`Total: ${results.length} | Successful: ${successful} | Failed: ${failed}`);
};

runTests().catch((error: unknown) => {
  logError(`Test runner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_FAILURE);
});
