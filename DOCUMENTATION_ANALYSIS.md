# Documentation vs Implementation Analysis

This document summarizes the analysis of design documents in `/docs` against the actual implementation.

**Analysis Date:** 2026-02-04

---

## Summary

| Document | Status | Action Required |
|----------|--------|-----------------|
| memory-based-slot-calculation.md | ✅ Matches | None |
| e2e-distributed-tests-design.md | ✅ Updated | None |
| maxWaitMS-design.md | ✅ Matches | None |
| actual-usage-adjustment-design.md | ✅ Matches | None |
| distributed-capacity-tracking-design.md | ✅ Updated | None |
| distributed-slots-design.md | ✅ Matches | Minor cleanup |

---

## Detailed Findings

### 1. memory-based-slot-calculation.md

**Status:** ✅ Implementation matches documentation

The implementation accurately represents the documented design:

- Memory is a LOCAL constraint (not distributed via Redis)
- Formula correctly implemented: `finalSlots = min(distributedSlots, localMemorySlots)`
- Memory slot calculation: `floor(memoryForJobType / estimatedMemoryKB)`
- `minCapacity`/`maxCapacity` bounds applied per-model after memory constraint with scaling
- Ratio determines memory portion per job type

**Key Files:**
- `packages/core/src/utils/memoryUtils.ts` - Memory detection and heap limit parsing
- `packages/core/src/utils/availabilityTracker.ts` - Memory slot calculation (lines 235-316)

---

### 2. e2e-distributed-tests-design.md

**Status:** ✅ Updated to match implementation

Documentation has been rewritten to reflect the pool-based architecture:

- Describes pool-based slot allocation (Redis tracks per-model, local handles job types)
- Uses correct `allocation.pools[modelId].totalSlots` structure
- Explains separation of concerns: Redis pools vs local JobTypeManager ratios
- Test assertions reflect actual implementation behavior

---

### 3. maxWaitMS-design.md

**Status:** ✅ Implementation matches documentation

All key features implemented as specified:

- Default `maxWaitMS` calculation: `(60 - currentSeconds + 5) * 1000` ms
- Per-job-type, per-model configuration structure
- Compile-time type safety for model IDs via TypeScript generics
- FIFO queue-based waiting in `CapacityWaitQueue`
- Fail-fast behavior for `maxWaitMS = 0`
- Wake-up triggers: job completion, window reset, timeout, backend allocation change
- Error message: `'All models exhausted: no capacity available within maxWaitMS'`

**Key Files:**
- `packages/core/src/utils/jobExecutionHelpers.ts` - `calculateDefaultMaxWaitMS()`, `getMaxWaitMS()`, `selectModelWithWait()`
- `packages/core/src/utils/capacityWaitQueue.ts` - FIFO queue implementation

---

### 4. actual-usage-adjustment-design.md

**Status:** ✅ Implementation matches documentation

Core behaviors correctly implemented:

- Actual vs estimated comparison with refund/overage handling
- Time-window-aware refunds via `subtractIfSameWindow()`
- All three job completion scenarios:
  1. **Job succeeds:** Full adjustment flow with backend notification
  2. **Job throws without reject():** Time-windowed capacity NOT released, memory/concurrency ARE released
  3. **Job calls reject(usage):** Same adjustment flow as success
- Overage events emitted when `actual > estimated`
- `requestCount` is required in `TokenUsageEntry` (used by reject callback)

**Key Files:**
- `packages/core/src/rateLimiter.ts` - `recordActualUsage()`, `queueJobWithReservedCapacity()`
- `packages/core/src/utils/timeWindowCounter.ts` - `subtractIfSameWindow()`

---

### 5. distributed-capacity-tracking-design.md

**Status:** ✅ Updated to match implementation

Documentation has been updated to reflect the pool-based architecture:

- `BackendReleaseContext` interface updated: removed `jobType`, added `estimated`
- `AllocationInfo` interface updated: uses `pools` structure instead of `slotsByJobTypeAndModel`
- Lua script pseudocode updated to reflect pool-based allocation
- Explains that job type distribution is local-only

---

### 6. distributed-slots-design.md

**Status:** ✅ Implementation matches documentation

The implementation accurately represents the documented pool-based design:

- Pool-based architecture: Redis tracks per-model, local handles job types
- `AllocationInfo` structure matches exactly
- Pool calculation: `floor((remainingCapacity / estimatedResourcePerJob) / instanceCount)`
- Two-layer acquire/release (local check then Redis check)
- Dynamic ratio adjustment:
  - Config defaults match: `highLoadThreshold: 0.7`, `lowLoadThreshold: 0.3`, etc.
  - 5-step algorithm: identify donors → identify receivers → calculate contributions → transfer → normalize
  - Triggers: periodic (5s) and release-based (every 10 releases)
- Information boundaries respected (Redis unaware of job types)

**Minor Issues:**
- Debug `console.log` statements in `packages/core/src/multiModelRateLimiter.ts` (lines 157, 160, 166, 191) should be removed or converted to proper logging

**Key Files:**
- `packages/redis/src/luaScripts.ts` - Redis Lua scripts
- `packages/core/src/utils/jobTypeManager.ts` - Local ratio management
- `packages/core/src/utils/jobTypeHelpers.ts` - Ratio adjustment algorithm

---

## Remaining Recommendations

1. **Low Priority:** Remove debug `console.log` statements from `multiModelRateLimiter.ts`
