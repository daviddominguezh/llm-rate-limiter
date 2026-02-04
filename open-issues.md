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

**Status:** Open

**Description:**
Jobs waiting in the `CapacityWaitQueue` are NOT proactively woken when TPM/RPM counters reset at minute boundaries. Jobs rely on other job completions or their individual timeouts to be processed.

**Impact:** Medium - Jobs may wait longer than necessary under low-traffic conditions

**Files to modify:**
- `packages/core/src/utils/capacityWaitQueue.ts`
- `packages/core/src/rateLimiter.ts`

**Current behavior:**
- `notifyCapacityAvailable()` only called when jobs complete
- No timer mechanism for minute boundary resets

**Recommended fix:**
1. Calculate time until next minute boundary
2. Set timer to call `notifyCapacityAvailable()` at that time
3. Repeat while waiters exist in queue

---

## Medium Priority

### Issue #4: Slot calculation uses hierarchy instead of min()

**Status:** Open

**Description:**
The design specifies that slot calculation should use `min(TPM-based, RPM-based, TPD-based, RPD-based, Concurrent)` to pick the most restrictive limit. However, the implementation uses a priority hierarchy: `maxConcurrent > TPM > RPM`.

**Impact:** Medium - May not pick most restrictive limit in all cases

**Files to modify:**
- `packages/redis/src/luaScripts.ts`

**Current behavior (lines 71-82):**
```lua
if model.maxConcurrentRequests and model.maxConcurrentRequests > 0 then
  baseCapacity = model.maxConcurrentRequests
elseif model.tokensPerMinute and model.tokensPerMinute > 0 then
  baseCapacity = math.floor(model.tokensPerMinute / estimatedTokens)
elseif model.requestsPerMinute and model.requestsPerMinute > 0 then
  baseCapacity = math.floor(model.requestsPerMinute / estimatedRequests)
else
  baseCapacity = 100
end
```

**Expected behavior:**
Calculate all applicable limits and take the minimum.

---

### Issue #5: `slotCalc-memory` test preset missing

**Status:** Open

**Description:**
The test preset `slotCalc-memory` is documented in `docs/e2e-distributed-slots-tests.md` but not implemented in the test configuration.

**Impact:** Medium - Memory-based slot calculation tests cannot run

**Files to modify:**
- `packages/e2e/serverInstance/src/rateLimiterConfigs.ts`

**Recommended fix:**
1. Implement `slotCalc-memory` configuration preset
2. Add memory-based slot calculation tests

---

## Low Priority

### Issue #6: Debug console.log statements in production code

**Status:** Open

**Description:**
Several files contain debug `console.log` statements that should be removed before production.

**Impact:** Low - Clutters logs, potential performance impact

**Files to modify:**

| File | Line(s) |
|------|---------|
| `packages/core/src/multiModelRateLimiter.ts` | 154, 157, 163, 183 |
| `packages/core/src/utils/timeWindowCounter.ts` | 39 |

---

### Issue #7: Document numbering issue in e2e tests doc

**Status:** Open

**Description:**
"Test Case 6" appears twice in the Slot Calculation section of the E2E tests documentation.

**Impact:** Low - Documentation clarity

**Files to modify:**
- `docs/e2e-distributed-slots-tests.md`

---

### Issue #8: Overage tracking not implemented

**Status:** Open (Future Enhancement)

**Description:**
The design document mentions tracking when `actual > estimated` for future estimation improvements. This is not currently implemented.

**Impact:** Low - Noted as future enhancement in design

**Files to modify:**
- `packages/core/src/rateLimiter.ts`

**Note:** This was explicitly deferred in the design document.

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
| High | 1 | #3 |
| Medium | 2 | #4, #5 |
| Low | 4 | #6, #7, #8, #9 |
| **Total Open** | **7** | |
| **Resolved** | **2** | #1, #2 |
