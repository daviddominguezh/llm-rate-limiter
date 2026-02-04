# Documentation vs Implementation Verification Report

**Generated:** 2026-02-04
**Status:** Analysis Complete

---

## Executive Summary

All 5 design documents in the `docs/` folder were analyzed against the current implementation. The implementation is largely compliant (~90-95%), with a few notable gaps and discrepancies documented below.

---

## 1. maxWaitMS Design (`docs/maxWaitMS-design.md`)

### Implemented Correctly

| Feature | Status | Implementation Location |
|---------|--------|------------------------|
| Core behavior (fail-fast vs queue-and-wait) | Match | `capacityWaitQueue.ts:40-78` |
| Default maxWaitMS calculation (time to next minute + 5s) | Match | `jobExecutionHelpers.ts:118-127` |
| Per-job-type, per-model configuration | Match | `jobTypeTypes.ts:58-94` |
| Type safety for model IDs | Match | `multiModelTypes.ts:139-145` |
| FIFO queue implementation | Match | `capacityWaitQueue.ts` |
| Timeout handling | Match | `capacityWaitQueue.ts:70-73` |
| Error message on exhaustion | Match | `jobDelegation.ts:129` |
| No override at queue time (design decision) | Match | `QueueJobOptions` interface |

### Missing / Discrepancies

| Issue | Description | Impact |
|-------|-------------|--------|
| **Rate limit window reset wake-up** | Jobs are NOT proactively woken when TPM/RPM counters reset at minute boundaries. Jobs rely on job completion or timeout to be processed. | Medium - Jobs may wait longer than necessary under low-traffic conditions |
| **Backend allocation change wake-up** | Unclear if queue is notified when distributed allocation changes | Low |

### Recommendation

Implement a timer-based mechanism to wake the queue when time windows reset:
1. Calculate time until next minute boundary
2. Set timer to call `notifyCapacityAvailable()` at that time
3. Repeat while waiters exist in queue

---

## 2. Memory-Based Slot Calculation (`docs/memory-based-slot-calculation.md`)

### Implemented Correctly

| Feature | Status | Implementation Location |
|---------|--------|------------------------|
| Final formula `min(distributed, memory)` | Match | `availabilityTracker.ts:107-150` |
| Memory is local (not distributed) | Match | `memoryUtils.ts`, `availabilityTracker.ts` |
| Ratio applies to memory | Match | `availabilityTracker.ts:279-287` |
| minCapacity/maxCapacity clamping after memory constraint | Match | `availabilityTracker.ts:116-150` |
| Memory detection via V8 heap stats | Match | `memoryUtils.ts` (improved from design) |

### Missing / Discrepancies

| Issue | Description | Impact |
|-------|-------------|--------|
| **TPD not implemented** | Tokens Per Day limit not included in distributed backend Lua scripts | High - Daily limits not enforced in distributed mode |
| **RPD not implemented** | Requests Per Day limit not included in distributed backend Lua scripts | High - Daily limits not enforced in distributed mode |
| **Slot calculation uses hierarchy** | Design specifies `min(TPM-based, RPM-based, TPD-based, RPD-based, Concurrent)` but implementation uses priority: `maxConcurrent > TPM > RPM` | Medium - May not pick most restrictive limit |

### Recommendation

1. Add TPD and RPD to Lua scripts in `luaScripts.ts`
2. Change slot calculation to take minimum of all applicable limits instead of hierarchy

---

## 3. E2E Distributed Slots Tests (`docs/e2e-distributed-slots-tests.md`)

### Implemented Correctly

| Feature | Status |
|---------|--------|
| `slotCalculation.test.ts` exists | Yes |
| `fixedRatioIsolation.test.ts` exists | Yes |
| `slotsEvolveWithLoad.test.ts` exists | Yes |
| `instanceScaling.test.ts` exists | Yes |
| `flexibleRatioAdjustment.test.ts` exists | Yes |
| `localRatioOnly.test.ts` exists | Yes |
| All config presets (except one) | Yes |
| Infrastructure functions | Yes |

### Missing / Discrepancies

| Issue | Description | Impact |
|-------|-------------|--------|
| **`slotCalc-memory` preset missing** | Documented in Test Configurations table (line 72) but not implemented in `rateLimiterConfigs.ts` | Medium - Memory-based slot tests cannot run |
| **Document numbering issue** | "Test Case 6" appears twice in Slot Calculation section | Low - Documentation clarity |

### Recommendation

1. Implement `slotCalc-memory` configuration preset
2. Add memory-based slot calculation tests
3. Fix document numbering (rename duplicate Test Case 6)

---

## 4. Distributed Slots Design (`docs/distributed-slots-design.md`)

### Implemented Correctly

| Feature | Status | Implementation Location |
|---------|--------|------------------------|
| Multi-dimensional slot calculation | Match | `luaScripts.ts:16-114` |
| AllocationInfo type structure | Match | `multiModelTypes.ts:403-425` |
| Per-job-type per-model acquire/release | Match | `luaScripts.ts:209-294` |
| Dynamic local ratios | Match | `jobTypeManager.ts:216-241` |
| Ratio adjustment config defaults | Match | `jobTypeManager.ts` |
| Pub/Sub message format | Match | `luaScripts.ts:109-111` |
| Backend configuration | Match | `redisBackendFactory.ts` |
| Time-window-aware refunds | Match | `timeWindowCounter.ts` |

### Minor Deviations

| Issue | Description | Impact |
|-------|-------------|--------|
| **Availability callback format** | Design shows callback receiving full `AllocationInfo`, implementation passes aggregated `Availability` object | Low - Full allocation available via `getAllocation()` |
| **Allocation application indirection** | `applyAllocationToLimiters` divides TPM/RPM by instanceCount from config rather than using pre-calculated values from `slotsByJobTypeAndModel` | Low - Functionally equivalent |

---

## 5. Actual Usage Adjustment Design (`docs/actual-usage-adjustment-design.md`)

### Implemented Correctly

| Feature | Status | Implementation Location |
|---------|--------|------------------------|
| `JobWindowStarts` type | Match | `types.ts:177-196` |
| `ReservationContext` type | Match | `types.ts:177-196` |
| `getWindowStart()` method | Match | `timeWindowCounter.ts:84-92` |
| `subtractIfSameWindow()` method | Match | `timeWindowCounter.ts:101-115` |
| `tryReserve()` returns context with window starts | Match | `rateLimiter.ts:392-440` |
| Window-aware refunds (TPM/RPM/TPD/RPD) | Match | `rateLimiter.ts:265-305` |
| Immediate release for concurrent/memory | Match | `rateLimiter.ts:537-549` |
| No negative capacity (`Math.max(0, ...)`) | Match | Multiple locations |
| Generic CapacityWaitQueue | Match | `capacityWaitQueue.ts:26` |
| Reservation context flow through delegation | Match | `jobDelegation.ts`, `jobExecutor.ts` |

### Missing / Discrepancies

| Issue | Description | Impact |
|-------|-------------|--------|
| **Overage tracking not implemented** | Design mentions tracking when `actual > estimated` for future estimation improvements | Low - Noted as future enhancement in design |
| **Cached tokens not included** | `recordActualUsage` uses `usage.input + usage.output` but not `usage.cached` | Low - May be intentional |

---

## Cross-Cutting Issues

### Debug Console.log Statements in Production Code

The following files contain debug logging that should be removed:

| File | Line(s) | Content |
|------|---------|---------|
| `packages/core/src/multiModelRateLimiter.ts` | 154, 159, 163, 183-184 | `console.log` debug statements |
| `packages/core/src/utils/timeWindowCounter.ts` | 39 | `console.log(\`[DEBUG] ${this.name} setLimit called...` |
| `packages/core/src/rateLimiter.ts` | 149 | `this.log('[DEBUG] waitForTimeWindowCapacity', ...)` |

---

## Priority Action Items

### High Priority

| # | Issue | Files to Modify |
|---|-------|-----------------|
| 1 | Implement TPD in distributed backend | `packages/redis/src/luaScripts.ts` |
| 2 | Implement RPD in distributed backend | `packages/redis/src/luaScripts.ts` |
| 3 | Rate limit window reset should wake queued jobs | `packages/core/src/utils/capacityWaitQueue.ts`, `rateLimiter.ts` |

### Medium Priority

| # | Issue | Files to Modify |
|---|-------|-----------------|
| 4 | Implement `slotCalc-memory` test preset | `packages/e2e/testRunner/src/rateLimiterConfigs.ts` |
| 5 | Change slot calculation from hierarchy to min() | `packages/redis/src/luaScripts.ts` |
| 6 | Add memory-based slot calculation tests | `packages/e2e/testRunner/src/__tests__/` |

### Low Priority

| # | Issue | Files to Modify |
|---|-------|-----------------|
| 7 | Remove debug console.log statements | Multiple files (see above) |
| 8 | Fix document numbering in e2e tests doc | `docs/e2e-distributed-slots-tests.md` |
| 9 | Consider implementing overage tracking | `packages/core/src/rateLimiter.ts` |
| 10 | Consider including cached tokens in usage | `packages/core/src/rateLimiter.ts` |

---

## Compliance Summary

| Document | Compliance | Critical Issues |
|----------|------------|-----------------|
| maxWaitMS-design.md | ~95% | Window reset wake-up missing |
| memory-based-slot-calculation.md | ~80% | TPD/RPD not implemented, hierarchy vs min |
| e2e-distributed-slots-tests.md | ~95% | slotCalc-memory preset missing |
| distributed-slots-design.md | ~98% | Minor callback format deviation |
| actual-usage-adjustment-design.md | ~95% | Overage tracking deferred |

**Overall Implementation Compliance: ~93%**
