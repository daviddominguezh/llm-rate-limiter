/**
 * Job queueing helpers for the LLM Rate Limiter class.
 */
import type { ResourceEstimationsPerJob } from '../jobTypeTypes.js';
import type {
  ActiveJobInfo,
  ArgsWithoutModelId,
  JobExecutionContext,
  JobUsage,
  LLMJobResult,
  QueueJobOptions,
} from '../multiModelTypes.js';
import type { InternalJobResult, InternalLimiterInstance } from '../types.js';
import { createInitialActiveJobInfo, updateJobStatus } from './activeJobTracker.js';
import type { DelegationContext } from './jobDelegation.js';
import { executeWithDelegation } from './jobDelegation.js';
import type { JobTypeManager } from './jobTypeManager.js';
import { validateJobTypeExists } from './jobTypeValidation.js';
import type { MemoryManagerInstance } from './memoryManager.js';
import { acquireJobTypeSlot } from './rateLimiterOperations.js';

interface QueueJobContext {
  activeJobs: Map<string, ActiveJobInfo>;
  jobTypeManager: JobTypeManager | null;
  resourceEstimationsPerJob: ResourceEstimationsPerJob;
  buildDelegationContext: (jobType: string) => DelegationContext;
}

/**
 * Execute the main queueJob logic.
 */
export const executeQueueJob = async <T, Args extends ArgsWithoutModelId = ArgsWithoutModelId>(
  options: QueueJobOptions<T, Args>,
  context: QueueJobContext
): Promise<LLMJobResult<T>> => {
  const { jobId, jobType, job } = options;
  const {
    activeJobs,
    jobTypeManager: manager,
    resourceEstimationsPerJob: cfg,
    buildDelegationContext,
  } = context;
  validateJobTypeExists(jobType, cfg);

  activeJobs.set(jobId, createInitialActiveJobInfo(jobId, jobType, Date.now()));
  const acquired = await acquireJobTypeSlot({ manager, resourcesConfig: cfg, jobType });
  updateJobStatus(activeJobs, jobId, 'waiting-for-model');

  const usage: JobUsage = [];
  const ctx: JobExecutionContext<T, Args> = {
    jobId,
    jobType,
    job,
    args: options.args,
    triedModels: new Set<string>(),
    usage,
    onComplete: options.onComplete,
    onError: options.onError,
  };
  try {
    return await executeWithDelegation(buildDelegationContext(jobType), ctx);
  } finally {
    if (acquired) {
      manager?.release(jobType);
    }
    activeJobs.delete(jobId);
  }
};

interface QueueJobForModelContext {
  memoryManager: MemoryManagerInstance | null;
  getModelLimiter: (modelId: string) => InternalLimiterInstance;
}

/**
 * Execute queueJobForModel logic.
 */
export const executeQueueJobForModel = async <T extends InternalJobResult>(
  modelId: string,
  job: () => Promise<T> | T,
  context: QueueJobForModelContext
): Promise<T> => {
  const { memoryManager, getModelLimiter } = context;
  const limiter = getModelLimiter(modelId);
  await memoryManager?.acquire(modelId);
  try {
    return await limiter.queueJob(job);
  } finally {
    memoryManager?.release(modelId);
  }
};
