/**
 * Test suite: Mega Comprehensive (Test 50, Phases 1-9)
 *
 * Covers ~50 features across single-instance and distributed modes:
 * - Phase 1: Slot calculation (5 rate dimensions, memory, ratios)
 * - Phase 2: Queue + escalation (maxWaitMS, priority, model fallback)
 * - Phase 3: Actual usage (refunds, overages, zero, token breakdown)
 * - Phase 4: Error handling (throw, reject with usage)
 * - Phase 5: Flexible ratio adjustment (donor/receiver, fixed protection)
 * - Phase 6: Instance scaling (pub/sub, redistribution, memory independence)
 * - Phase 7: Distributed operations (global tracking, acquire/release, wait queues)
 * - Phase 8: Allocation change wakes queue, stale cleanup
 * - Phase 9: Time window boundary (cross-window no-refund)
 */
import { killAllInstances } from '../instanceLifecycle.js';
import {
  verifyActualUsage,
  verifyErrorHandling,
  verifyFinalSlots,
  verifyQueueAndEscalation,
  verifyRatioAdjustment,
  verifySlotCalculation,
} from './megaComprehensiveAssertHelpers.js';
import type { DataCollectionContext } from './megaComprehensiveDataHelpers.js';
import {
  addSnapshot,
  createDataCollection,
  saveAndStopCollection,
  startDataCollection,
} from './megaComprehensiveDataHelpers.js';
import {
  verifyAllocationChangeWakesQueue,
  verifyDistributedOps,
  verifyInstanceScaling,
  verifyTimeWindowBoundary,
} from './megaComprehensiveDistributedHelpers.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  PHASE_TIMEOUT_MS,
  PORT_A,
  PORT_B,
  TIME_WINDOW_PHASE_TIMEOUT_MS,
  setupSingleInstance,
  setupTwoInstances,
} from './megaComprehensiveHelpers.js';
import { setActiveCollector } from './megaComprehensiveJobHelpers.js';

const SINGLE_SUITE = 'mega-comprehensive';
const DISTRIBUTED_SUITE = 'mega-comprehensive-distributed';
const BASE_URL_A = `http://localhost:${String(PORT_A)}`;
const BASE_URL_B = `http://localhost:${String(PORT_B)}`;

const testState: {
  singleCtx: DataCollectionContext | null;
  distributedCtx: DataCollectionContext | null;
} = { singleCtx: null, distributedCtx: null };

afterAll(async () => {
  setActiveCollector(null);
  if (testState.singleCtx !== null) {
    await saveAndStopCollection(testState.singleCtx, SINGLE_SUITE);
  }
  if (testState.distributedCtx !== null) {
    await saveAndStopCollection(testState.distributedCtx, DISTRIBUTED_SUITE);
  }
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Run phase and optionally record snapshot */
const runPhaseWithSnapshot = async (phaseFn: () => Promise<void>, snapshotLabel: string): Promise<void> => {
  await phaseFn();
  if (testState.distributedCtx !== null) {
    await addSnapshot(testState.distributedCtx, snapshotLabel);
  }
};

// ---- Single Instance Phases (1-5) ----

describe('Mega Comprehensive - Phases 1-3', () => {
  beforeAll(async () => {
    await setupSingleInstance();
    testState.singleCtx = createDataCollection([BASE_URL_A]);
    setActiveCollector(testState.singleCtx.collector);
    await startDataCollection(testState.singleCtx);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'Phase 1: Slot calculation',
    async () => {
      await verifySlotCalculation();
      await verifyFinalSlots();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 2: Fill capacity, queue, and model escalation',
    async () => {
      await verifyQueueAndEscalation();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 3: Actual usage - refunds, overages, zero, breakdown',
    async () => {
      await verifyActualUsage();
    },
    PHASE_TIMEOUT_MS
  );
});

describe('Mega Comprehensive - Phases 4-5', () => {
  beforeAll(async () => {
    await setupSingleInstance();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'Phase 4: Error handling - throw and reject',
    async () => {
      await verifyErrorHandling();
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 5: Flexible ratio adjustment',
    async () => {
      await verifyRatioAdjustment();
    },
    PHASE_TIMEOUT_MS
  );
});

// ---- Distributed Phases (6-9) ----

describe('Mega Comprehensive - Distributed', () => {
  beforeAll(async () => {
    await setupTwoInstances();
    testState.distributedCtx = createDataCollection([BASE_URL_A, BASE_URL_B]);
    setActiveCollector(testState.distributedCtx.collector);
    await startDataCollection(testState.distributedCtx);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    if (testState.distributedCtx !== null) {
      await saveAndStopCollection(testState.distributedCtx, DISTRIBUTED_SUITE);
    }
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'Phase 6: Instance scaling',
    async () => {
      await runPhaseWithSnapshot(verifyInstanceScaling, 'phase-6-complete');
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 7: Distributed operations',
    async () => {
      await runPhaseWithSnapshot(verifyDistributedOps, 'phase-7-complete');
    },
    PHASE_TIMEOUT_MS
  );

  it(
    'Phase 8: Allocation change wakes queue',
    async () => {
      await runPhaseWithSnapshot(verifyAllocationChangeWakesQueue, 'phase-8-complete');
    },
    PHASE_TIMEOUT_MS
  );
});

describe('Mega Comprehensive - Time Window', () => {
  beforeAll(async () => {
    await setupSingleInstance();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await killAllInstances();
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    'Phase 9: Time window boundary behavior',
    async () => {
      await verifyTimeWindowBoundary();
    },
    TIME_WINDOW_PHASE_TIMEOUT_MS
  );
});
