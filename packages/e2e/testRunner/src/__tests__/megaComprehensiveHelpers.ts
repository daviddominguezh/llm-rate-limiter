/**
 * Shared constants and instance lifecycle helpers for mega comprehensive test.
 *
 * Config: mega-comprehensive
 * - 3 models: model-alpha (all 5 rate dims), model-beta, model-gamma
 * - 4 job types: critical (0.4), standard (0.3), lowPriority (0.1), fixedBatch (0.2)
 * - Memory: 100MB maxMemoryKB, freeMemoryRatio=0.8 -> 80MB usable
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';

import {
  bootInstance,
  cleanRedis,
  killAllInstances,
  killInstance,
  waitForAllocationUpdate,
} from '../instanceLifecycle.js';
import type { ConfigPresetName } from '../resetInstance.js';
import { sleep } from '../testUtils.js';

// Ports
export const PORT_A = 4001;
export const PORT_B = 4002;

// Config
export const CONFIG_PRESET: ConfigPresetName = 'mega-comprehensive';

// Model IDs
export const MODEL_ALPHA = 'model-alpha';
export const MODEL_BETA = 'model-beta';
export const MODEL_GAMMA = 'model-gamma';

// Job type names
export const JOB_CRITICAL = 'critical';
export const JOB_STANDARD = 'standard';
export const JOB_LOW_PRIORITY = 'lowPriority';
export const JOB_FIXED_BATCH = 'fixedBatch';

// HTTP status
export const HTTP_ACCEPTED = 202;
export const HTTP_OK = 200;

// Expected slot calculations (1 instance, model-alpha)
export const SINGLE_INSTANCE_ALPHA_SLOTS = 3;
export const MEMORY_SLOTS = 10;
export const FINAL_SLOTS_SINGLE = 3;

// Expected slot calculations (2 instances, model-alpha)
export const TWO_INSTANCE_ALPHA_SLOTS = 1;
export const EXPECTED_TWO_INSTANCES = 2;
export const EXPECTED_ONE_INSTANCE = 1;

// Timing constants
export const ALLOCATION_PROPAGATION_MS = 2000;
export const INSTANCE_CLEANUP_TIMEOUT_MS = 20000;

// Timeouts
export const BEFORE_ALL_TIMEOUT_MS = 60000;
export const AFTER_ALL_TIMEOUT_MS = 30000;
export const PHASE_TIMEOUT_MS = 90000;
export const TIME_WINDOW_PHASE_TIMEOUT_MS = 120000;

// Thresholds
export const IMMEDIATE_DELEGATION_THRESHOLD_MS = 500;
export const QUEUE_MIN_DURATION_MS = 1000;
export const REALLOCATION_WAKE_THRESHOLD_MS = 5000;

/** Setup a single instance with mega-comprehensive config */
export const setupSingleInstance = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Setup two instances with mega-comprehensive config */
export const setupTwoInstances = async (): Promise<void> => {
  await killAllInstances();
  await cleanRedis();
  await bootInstance(PORT_A, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
  await bootInstance(PORT_B, CONFIG_PRESET);
  await sleep(ALLOCATION_PROPAGATION_MS);
};

/** Kill instance B and wait for reallocation on A */
export const killInstanceBAndWaitForReallocation = async (): Promise<void> => {
  await killInstance(PORT_B);
  await waitForAllocationUpdate(
    PORT_A,
    (alloc: AllocationInfo) => alloc.instanceCount === EXPECTED_ONE_INSTANCE,
    INSTANCE_CLEANUP_TIMEOUT_MS
  );
};

export { fetchAllocation, killAllInstances } from '../instanceLifecycle.js';
