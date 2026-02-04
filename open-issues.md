# Open Issues

**Generated:** 2026-02-04
**Updated:** 2026-02-04
**Source:** Documentation vs Implementation Verification Report

---

## High Priority

### Issue #1: TPD (Tokens Per Day) not implemented in distributed backend

**Status:** RESOLVED

**Description:**
Tokens Per Day limit is not included in the distributed backend Lua scripts. Daily token limits are only enforced locally via `TimeWindowCounter`, not coordinated across instances.

**Impact:** High - Daily token limits not enforced in distributed mode

**Resolution:**
- Added `tokensPerDay` to `ModelCapacityConfig` in `packages/redis/src/types.ts`
- Added `tokensPerDay` to `ModelSlotAllocationData` in `packages/redis/src/types.ts`
- Updated `extractModelCapacities()` in `packages/redis/src/redisBackendFactory.ts`
- Added TPD to slot calculation hierarchy in `packages/redis/src/luaScripts.ts`
- Added `tokensPerDay` to `ModelSlotAllocation` in `packages/core/src/multiModelTypes.ts`

---

### Issue #2: RPD (Requests Per Day) not implemented in distributed backend

**Status:** RESOLVED

**Description:**
Requests Per Day limit is not included in the distributed backend Lua scripts. Daily request limits are only enforced locally via `TimeWindowCounter`, not coordinated across instances.

**Impact:** High - Daily request limits not enforced in distributed mode

**Resolution:**
- Added `requestsPerDay` to `ModelCapacityConfig` in `packages/redis/src/types.ts`
- Added `requestsPerDay` to `ModelSlotAllocationData` in `packages/redis/src/types.ts`
- Updated `extractModelCapacities()` in `packages/redis/src/redisBackendFactory.ts`
- Added RPD to slot calculation hierarchy in `packages/redis/src/luaScripts.ts`
- Added `requestsPerDay` to `ModelSlotAllocation` in `packages/core/src/multiModelTypes.ts`

---

### Issue #3: Rate limit window reset should wake queued jobs

**Status:** RESOLVED

**Description:**
Jobs waiting in the `CapacityWaitQueue` are NOT proactively woken when TPM/RPM counters reset at minute boundaries. Jobs rely on other job completions or their individual timeouts to be processed.

**Impact:** Medium - Jobs may wait longer than necessary under low-traffic conditions

**Resolution:**
- Added `hasWaiters()` method to `packages/core/src/utils/capacityWaitQueue.ts`
- Added `windowResetTimerId` field to track scheduled notifications
- Added `getTimeUntilNextWindowReset()` to calculate minimum time until any window resets (RPM, RPD, TPM, TPD)
- Added `scheduleWindowResetNotification()` to set timer at next window boundary
- Updated `notifyCapacityAvailable()` to schedule timer after processing queue
- Updated `stop()` to clear the timer on shutdown

---

## Medium Priority

### Issue #4: Slot calculation uses hierarchy instead of min()

**Status:** RESOLVED

**Description:**
The design specifies that slot calculation should use `min(TPM-based, RPM-based, TPD-based, RPD-based, Concurrent)` to pick the most restrictive limit. However, the implementation uses a priority hierarchy: `maxConcurrent > TPM > RPM`.

**Impact:** Medium - May not pick most restrictive limit in all cases

**Resolution:**
- Changed slot calculation in `packages/redis/src/luaScripts.ts` from hierarchy to min()
- Now calculates slots from each applicable limit (Concurrent, TPM, RPM, TPD, RPD)
- Takes the minimum of all calculated values (most restrictive limit)
- Falls back to 100 only if no limits are configured

---

### Issue #5: `slotCalc-memory` test preset missing

**Status:** RESOLVED

**Description:**
The test preset `slotCalc-memory` is documented in `docs/e2e-distributed-slots-tests.md` but not implemented in the test configuration.

**Impact:** Medium - Memory-based slot calculation tests cannot run

**Resolution:**
- Added `slotCalcMemoryConfig` preset with high TPM (10M) and two job types with different memory estimates
- `heavyMemoryJob`: 10MB per job (`estimatedUsedMemoryKB: 10240`)
- `lightMemoryJob`: 1MB per job (`estimatedUsedMemoryKB: 1024`)
- Added `'slotCalc-memory'` to `ConfigPresetName` type
- Added config to `configPresets` record

---

## Low Priority

### Issue #6: Debug console.log statements in production code

**Status:** NOT RELEVANT

**Description:**
Several files contain debug `console.log` statements that should be removed before production.

**Impact:** Low - Clutters logs, potential performance impact

**Note:** Marked as not relevant per user decision.

---

### Issue #7: Document numbering issue in e2e tests doc

**Status:** RESOLVED

**Description:**
"Test Case 6" appears twice in the Slot Calculation section of the E2E tests documentation.

**Impact:** Low - Documentation clarity

**Resolution:**
Verified that the documentation now has correct numbering (Test Cases 1-7 in Slot Calculation section). The duplicate no longer exists.

---

### Issue #8: Overage tracking not implemented

**Status:** RESOLVED

**Description:**
The design document mentions tracking when `actual > estimated` for future estimation improvements. This is not currently implemented.

**Impact:** Low - Noted as future enhancement in design

**Resolution:**
- Added `OverageEvent` type with `resourceType`, `estimated`, `actual`, `overage`, and `timestamp` fields
- Added `OverageResourceType` type (`'tokens' | 'requests'`)
- Added `OverageFn` callback type and `onOverage` config option to `InternalLimiterConfigBase`
- Implemented `emitOverageIfNeeded()` helper method in `LLMRateLimiter`
- Updated `recordActualUsage()` to emit overage events when actual > estimated
- Exported new types from `rateLimiter.ts`

---

### Issue #9: Cached tokens not included in usage tracking

**Status:** Open (Needs Discussion)

**Description:**
`recordActualUsage` uses `usage.input + usage.output` but does not include `usage.cached`. This may be intentional since cached tokens are not "consumed" from the model's perspective.

**Impact:** Low - May be intentional design decision

**Files to modify:**
- `packages/core/src/rateLimiter.ts`

**Current behavior:**
```typescript
this.recordTokenUsage(usage.input + usage.output, windowStarts);
```

**Question:** Should cached tokens be included in usage tracking?

---

## Summary

| Priority | Count | Issues |
|----------|-------|--------|
| High | 0 | - |
| Medium | 0 | - |
| Low | 1 | #9 |
| **Total Open** | **1** | |
| **Resolved** | **7** | #1, #2, #3, #4, #5, #7, #8 |
| **Not Relevant** | **1** | #6 |
