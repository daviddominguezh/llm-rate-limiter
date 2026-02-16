/**
 * Test suite: Mega Comprehensive - Distributed (Test 50, Phases 6-9)
 *
 * Covers ~20 features in distributed mode:
 * - Phase 6: Instance scaling (pub/sub, redistribution, memory independence)
 * - Phase 7: Distributed operations (global tracking, acquire/release, wait queues)
 * - Phase 8: Allocation change wakes queue, stale cleanup
 * - Phase 9: Time window boundary (cross-window no-refund)
 */
import { killAllInstances } from '../instanceLifecycle.js';
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

const DISTRIBUTED_SUITE = 'mega-comprehensive-distributed';
const BASE_URL_A = `http://localhost:${String(PORT_A)}`;
const BASE_URL_B = `http://localhost:${String(PORT_B)}`;

const testState: { ctx: DataCollectionContext | null } = { ctx: null };

afterAll(async () => {
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

/** Run phase and optionally record snapshot */
const runPhaseWithSnapshot = async (phaseFn: () => Promise<void>, snapshotLabel: string): Promise<void> => {
  await phaseFn();
  if (testState.ctx !== null) {
    await addSnapshot(testState.ctx, snapshotLabel);
  }
};

describe('Mega Comprehensive - Distributed', () => {
  beforeAll(async () => {
    await setupTwoInstances();
    testState.ctx = createDataCollection([BASE_URL_A, BASE_URL_B]);
    await startDataCollection(testState.ctx);
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    if (testState.ctx !== null) {
      await saveAndStopCollection(testState.ctx, DISTRIBUTED_SUITE);
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
