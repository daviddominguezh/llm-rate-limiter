/**
 * Test suite: Mega Comprehensive - Single Instance (Test 50, Phases 1-5)
 *
 * Covers ~30 features in single-instance mode:
 * - Phase 1: Slot calculation (5 rate dimensions, memory, ratios)
 * - Phase 2: Queue + escalation (maxWaitMS, priority, model fallback)
 * - Phase 3: Actual usage (refunds, overages, zero, token breakdown)
 * - Phase 4: Error handling (throw, reject with usage)
 * - Phase 5: Flexible ratio adjustment (donor/receiver, fixed protection)
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
  createDataCollection,
  saveAndStopCollection,
  startDataCollection,
} from './megaComprehensiveDataHelpers.js';
import {
  AFTER_ALL_TIMEOUT_MS,
  BEFORE_ALL_TIMEOUT_MS,
  PHASE_TIMEOUT_MS,
  PORT_A,
  setupSingleInstance,
} from './megaComprehensiveHelpers.js';

const SINGLE_SUITE = 'mega-comprehensive';
const BASE_URL_A = `http://localhost:${String(PORT_A)}`;

const testState: { ctx: DataCollectionContext | null } = { ctx: null };

afterAll(async () => {
  if (testState.ctx !== null) {
    await saveAndStopCollection(testState.ctx, SINGLE_SUITE);
  }
  await killAllInstances();
}, AFTER_ALL_TIMEOUT_MS);

describe('Mega Comprehensive - Phases 1-3', () => {
  beforeAll(async () => {
    await setupSingleInstance();
    testState.ctx = createDataCollection([BASE_URL_A]);
    await startDataCollection(testState.ctx);
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
