# Documentation Verification Report

This report summarizes the verification of all documentation files in the `docs/` folder against the actual code implementation.

---

## 1. `maxWaitMS-design.md`

| Claim | Status | Notes |
|-------|--------|-------|
| Controls wait time before delegation | ✓ Accurate | |
| Default formula `(60 - seconds + 5) * 1000` | ✓ Accurate | |
| `maxWaitMS: 0` = fail fast | ✓ Accurate | |
| Per job type, per model config | ✓ Accurate | |
| Type-safe model ID validation | ✓ Accurate | |
| **Queue-based (FIFO) waiting** | ✓ **FIXED** | Now uses `CapacityWaitQueue` with FIFO ordering |

### Issue #1: Queue-based vs Polling-based waiting - **RESOLVED**

**Status:** FIXED

**Implementation:**
- Created `CapacityWaitQueue` class in `packages/core/src/utils/capacityWaitQueue.ts`
- Added `waitForCapacityWithTimeout()` method to `InternalLimiterInstance`
- Jobs are queued in FIFO order with individual timeouts
- When capacity is released, the first waiter in queue is served
- Removed old polling-based `waitForSpecificModelCapacity()` function completely

---

## 2. `memory-based-slot-calculation.md`

| Claim | Status | Notes |
|-------|--------|-------|
| Memory is LOCAL constraint | ✓ Accurate | |
| `finalSlots = min(dist, local)` | ✓ Accurate | |
| `memoryForJobType = totalMemory × ratio` | ✓ Accurate | |
| `floor(memoryForJobType / estimatedMemoryKB)` | ✓ Accurate | |
| Ratios apply to memory | ✓ Accurate | |
| **minCapacity/maxCapacity as slot bounds** | ✓ **FIXED** | Now applied per-model, per-job-type to slot counts |

### Issue #2: minCapacity/maxCapacity behavior - **RESOLVED**

**Status:** FIXED

**Implementation:**
- Added `ModelCapacityBounds` type to `availabilityTracker.ts`
- Added `applyMemoryConstraintAndClamping()` helper function that:
  1. Applies memory constraint first (scales slots proportionally)
  2. Then clamps each model's scaled slots (minCapacity can override memory limits)
- Updated `calculateSlotsWithMemoryConstraint()` to use the new flow
- Removed incorrect minCapacity/maxCapacity usage from `memoryManager.ts` and `rateLimiter.ts` (was clamping memory KB, not slots)
- Updated documentation to clarify the order: memory constraint → clamping

---

## 3. `e2e-distributed-slots-tests.md`

| Category | Status | Notes |
|----------|--------|-------|
| Test files exist | ✓ Accurate | All 6 test files exist |
| Slot formula | ✓ Accurate | |
| Allocation structure | ✓ Accurate | |
| Test cases | ✓ Accurate | |
| **Config presets** | ✓ **FIXED** | All 14 presets now documented |

### Issue #3: Incomplete config presets table - **RESOLVED**

**Status:** FIXED

**Implementation:**
- Added "Slot Calculation Presets" section to the Test Configuration Presets table
- Documented all 9 specialized slot calculation presets with their model limits, job types, and purpose

---

## 4. `distributed-slots-design.md`

| Category | Status | Notes |
|----------|--------|-------|
| AllocationInfo structure | ✓ Accurate | |
| Slot formula | ✓ Accurate | |
| Lua scripts present | ✓ Accurate | |
| JobTypeManager.adjustRatios() | ✓ Accurate | |
| RatioAdjustmentConfig | ✓ Accurate | |
| **UPDATE_RATIOS_SCRIPT** | ✓ **FIXED** | Removed - ratios are local by design |
| **Ratio synchronization** | ✓ **FIXED** | Updated docs to clarify ratios are local by design |
| **RELEASE_SCRIPT resource adjustment** | ✗ **NOT IMPLEMENTED** | Documented feature doesn't exist |

### Issue #4: UPDATE_RATIOS_SCRIPT - **RESOLVED**

**Status:** FIXED (by design decision)

**Resolution:**
- Ratios are intentionally LOCAL to each instance
- No `UPDATE_RATIOS_SCRIPT` is needed because ratios are not synchronized
- Documentation updated to remove references to this script
- Each instance optimizes for its own traffic pattern independently

---

### Issue #5: Ratio synchronization - **RESOLVED**

**Status:** FIXED (by design decision)

**Resolution:**
- Ratios are intentionally LOCAL, not distributed
- Documentation updated to clarify this design:
  - Each instance monitors its own load per job type
  - `JobTypeManager.adjustRatios()` recalculates ratios based on local load
  - No Redis synchronization occurs
- This design allows:
  - Different instances to optimize for different traffic patterns
  - Avoids thundering herd problems
  - Simpler, faster, more resilient system

---

### Issue #6: RELEASE_SCRIPT resource adjustment not implemented - **DESIGN COMPLETE**

**Location:** Lines 281-284

**Documentation says:**
> **RELEASE_SCRIPT**:
> - Release for specific job-type + model
> - Accept actual resource usage for capacity adjustment
> - Only adjust time-windowed limits if within same window

**Actual implementation:**
- Releases specific job-type + model slot ✓
- Decrements in-flight tracking ✓
- Triggers reallocation ✓
- **MISSING**: No mechanism to accept actual resource usage or adjust time-windowed limits

**Status:** DESIGN COMPLETE - See `docs/actual-usage-adjustment-design.md`

**Design Summary:**
- Created comprehensive design document for the "Actual Usage Adjustment" feature
- Key behavior: Refund unused capacity when actual < estimated, within same time window
- Time-windowed limits (TPM, RPM, TPD, RPD): Only adjust if job completes within same window
- Non-time-windowed limits (concurrent, memory): Always release immediately
- Implementation pending

---

## Summary of Required Fixes

| Doc | Issue | Severity | Action |
|-----|-------|----------|--------|
| maxWaitMS-design.md | Queue-based waiting | ~~Medium~~ | ✓ **FIXED** - Implemented FIFO queue |
| memory-based-slot-calculation.md | minCapacity/maxCapacity scope | ~~High~~ | ✓ **FIXED** - Implemented per-model, per-job-type slot clamping |
| e2e-distributed-slots-tests.md | Missing config presets | ~~Low~~ | ✓ **FIXED** - Added all 14 presets to documentation |
| distributed-slots-design.md | UPDATE_RATIOS_SCRIPT | ~~Medium~~ | ✓ **FIXED** - Removed (ratios are local by design) |
| distributed-slots-design.md | Ratio synchronization | ~~Medium~~ | ✓ **FIXED** - Clarified ratios are local by design |
| distributed-slots-design.md | RELEASE_SCRIPT resource adjustment | Medium | ✓ **DESIGN COMPLETE** - See `docs/actual-usage-adjustment-design.md` |
