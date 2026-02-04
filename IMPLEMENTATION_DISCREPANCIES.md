# Implementation Discrepancies Report

This document summarizes discrepancies between the design documentation and actual implementation, identified through systematic code review.

---

## Summary Table

| Issue | Status | Severity | Document |
|-------|--------|----------|----------|
| `reject()` missing `requestCount` | 🔴 OPEN | High | actual-usage-adjustment-design.md |
| Ratios not local as documented | 🔴 OPEN | High | distributed-slots-design.md |
| Memory not enforced per-job-type | 🔴 OPEN | Medium | memory-based-slot-calculation.md |
| Redis field names differ | ✅ RESOLVED | Medium | distributed-capacity-tracking-design.md |
| Daily TTL mismatch | ✅ RESOLVED | Low | distributed-capacity-tracking-design.md |

---

## 🔴 Open Issues

### 1. `reject()` Callback Missing `requestCount` Parameter

**Document**: `docs/actual-usage-adjustment-design.md`
**Severity**: High
**Location**: `packages/core/src/utils/jobExecutor.ts:56-74`

**Design Specification** (lines 116-139):
```typescript
interface RejectUsage {
  requestCount: number;  // User should provide this
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}
```

**Actual Implementation**:
```typescript
// packages/core/src/utils/jobExecutor.ts:67
mutableState.rejectUsage = {
  requests: 1,  // HARDCODED TO 1
  tokens: usage.inputTokens + usage.outputTokens + usage.cachedTokens,
};
```

**Impact**: Jobs that make multiple API calls before failing cannot report the actual request count. RPM/RPD counters will always show 1 request regardless of actual usage.

**Fix Required**: Add optional `requestCount` field to `TokenUsageEntry` interface and use it in the reject handler instead of hardcoding to 1.

---

### 2. Dynamic Ratios Are NOT Local-Only

**Document**: `docs/distributed-slots-design.md`
**Severity**: High
**Location**: `packages/redis/src/luaScripts.ts:101-122`

**Design Specification** (line 144):
> "Ratios are intentionally LOCAL to each instance — they are not synchronized across instances via Redis."

**Actual Implementation**:
The Lua script stores fixed ratios in Redis and applies the same ratio value to ALL instances:
```lua
-- luaScripts.ts:108
local ratio = jobType.ratio
```

The `JobTypeManager` (packages/core/src/utils/jobTypeManager.ts:216-241) does adjust ratios locally, but these adjustments:
- Only affect the local `AvailabilityTracker` callback
- Do NOT propagate to the Redis backend
- Are NOT used in distributed slot calculations

**Impact**: The documented per-instance ratio optimization doesn't work in distributed deployments. All instances use identical ratios from Redis initialization.

**Fix Required**: Either update documentation to reflect actual behavior, or implement per-instance ratio submission to Redis.

---

### 3. Memory Constraints Not Enforced Per-Job-Type

**Document**: `docs/memory-based-slot-calculation.md`
**Severity**: Medium
**Location**: `packages/core/src/utils/memoryManager.ts:45-49`

**Design Specification** (Step 2-4):
```
1. Instance calculates local memory slots: floor((totalMemory × jobTypeRatio) / estimatedMemoryKB)
2. Final slots: min(distributedSlots, memorySlots) per job type
```

**Actual Implementation**:
- `MemoryManager` uses a single global semaphore with `totalMemory * freeMemoryRatio`
- Does NOT divide memory allocation by job type
- All job types share one semaphore pool

**Where it IS correct**: `AvailabilityTracker.calculateSlotsWithMemoryConstraint()` (lines 246-297) correctly calculates per-job-type memory slots, but this is only used for the `onAvailableSlotsChange` callback, not for actual job execution.

**Impact**: A memory-heavy job type can starve lighter job types. The availability callback shows correct numbers, but actual enforcement uses a simpler global pool.

**Fix Required**: Implement per-job-type memory semaphores or update documentation to reflect the simpler global approach.

---

## ✅ Resolved Issues

### 4. Redis Hash Field Names ~~Differ from Design~~ (FIXED)

**Document**: `docs/distributed-capacity-tracking-design.md`
**Resolved**: 2024-02-04

**Original Issue**: Implementation used `tokens`/`requests` instead of `actualTokens`/`actualRequests`, and `lastUpdate` field was missing.

**Resolution**: Updated `packages/redis/src/luaScripts.ts` to use correct field names (`actualTokens`, `actualRequests`) and added `lastUpdate` timestamp field.

---

### 5. Daily Window TTL ~~Mismatch~~ (FIXED)

**Document**: `docs/distributed-capacity-tracking-design.md`
**Resolved**: 2024-02-04

**Original Issue**: Implementation used `DAY_TTL = 172800` (48 hours) instead of design spec of 25 hours (90,000 seconds).

**Resolution**: Updated `packages/redis/src/luaScripts.ts` to use `DAY_TTL = 90000` (25 hours) as specified in design.

---

## Documented Features Working Correctly

### e2e-distributed-slots-tests.md
All 6 test suites fully implemented:
- Slot calculation (TPM, RPM, TPD, RPD, concurrent)
- Instance scaling
- Fixed ratio isolation
- Flexible ratio adjustment
- Local ratio only
- Slots evolve with load

### maxWaitMS-design.md
Core features correctly implemented:
- Default calculation (5-65 seconds based on time to next minute)
- FIFO queue with timeout
- Model escalation on timeout
- Type-safe configuration
- Active job tracking with `waitStartedAt`, `maxWaitMS`, `timeoutAt`

### distributed-capacity-tracking-design.md
Core features correctly implemented:
- Global usage tracking in Redis per model per time window
- Dynamic limits calculation based on remaining capacity
- Pub/Sub broadcast of allocations with `dynamicLimits`
- Instances update local rate limiters via `setRateLimits()`

---

## Recommendations

### Immediate Actions
1. **Add `requestCount` to reject callback** - Critical for multi-request job tracking
2. **Update distributed-slots documentation** - Clarify that ratios are NOT local in distributed mode

### Documentation Updates
3. Document the global memory semaphore approach vs. per-job-type calculation
4. Add documentation for window reset notification feature in maxWaitMS

### Future Consideration
5. Evaluate whether per-instance local ratios should be implemented as designed, or if the current global ratio approach is acceptable
6. Consider implementing per-job-type memory semaphores if isolation is required

---

## File References

| Issue | Status | Primary Files | Key Lines |
|-------|--------|---------------|-----------|
| reject() requestCount | 🔴 OPEN | `packages/core/src/utils/jobExecutor.ts` | 56-74 |
| Local ratios | 🔴 OPEN | `packages/redis/src/luaScripts.ts` | 101-122 |
| Memory per-job-type | 🔴 OPEN | `packages/core/src/utils/memoryManager.ts` | 45-49 |
| Redis field names | ✅ RESOLVED | `packages/redis/src/luaScripts.ts` | 365-387 |
| Daily TTL | ✅ RESOLVED | `packages/redis/src/luaScripts.ts` | 359 |
