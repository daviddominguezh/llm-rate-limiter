# Actual Usage Adjustment - Design Document

**Status: IMPLEMENTED**

## Overview

This document describes the design for adjusting capacity based on actual resource consumption after a job completes, rather than relying solely on estimates.

### Implementation Summary

The feature has been implemented with the following key changes:

| File | Changes |
|------|---------|
| `packages/core/src/types.ts` | Added `JobWindowStarts`, `ReservationContext`, `OverageEvent` types |
| `packages/core/src/utils/timeWindowCounter.ts` | Added `getWindowStart()`, `subtractIfSameWindow()` |
| `packages/core/src/rateLimiter.ts` | Updated `tryReserve()` to return context, window-aware refunds, overage tracking |
| `packages/core/src/utils/jobDelegation.ts` | Pass reservation context through execution flow |
| `packages/core/src/utils/jobExecutor.ts` | Use reservation context in `queueJobWithReservedCapacity()`, handle reject usage |
| `packages/core/src/utils/capacityWaitQueue.ts` | Made generic to support `ReservationContext` |

## Problem Statement

The current system reserves capacity based on **estimated** resource consumption when a job starts. However, actual usage often differs from estimates:

- A "summary" job estimated at 10,000 tokens might only use 6,000 tokens
- A "fill" job estimated at 5,000 tokens might use 8,000 tokens

This creates two problems:

1. **Wasted Capacity**: When actual usage is less than estimated, unused capacity sits reserved until the job completes, preventing other jobs from using it.

2. **Capacity Accounting Drift**: Over time, if actuals consistently differ from estimates, the system's view of available capacity diverges from reality.

## Intended Behavior

### Core Concept

When a job completes, the system receives both:
- The **estimated** resources (reserved at job start)
- The **actual** resources (measured at job completion)

The system should **adjust capacity** based on the difference between estimated and actual usage.

### Adjustment Types

| Scenario | Action |
|----------|--------|
| Actual < Estimated | **Refund** the unused capacity (e.g., reserved 10K tokens, used 6K → refund 4K) |
| Actual > Estimated | **Add overage** to counters AND emit overage event for tracking (e.g., reserved 10K, used 15K → add 5K to counter) |
| Actual = Estimated | No adjustment needed |

### Job Completion Scenarios

The system must handle three distinct job completion scenarios:

#### 1. Job Succeeds (returns JobResult)

When a job completes successfully and returns a `JobResult`:

```typescript
return {
  data: myResult,
  requestCount: 3,
  inputTokens: 5000,
  outputTokens: 1500,
  cachedTokens: 500,
};
```

**Behavior:**
- Actual usage is extracted from the result
- Local rate limiters (TPM, RPM, TPD, RPD) are adjusted based on actual vs estimated
- Distributed backend is notified with actual usage
- Memory and concurrency slots are released
- If actual > estimated, overage is added to counters and `onOverage` callback is invoked

#### 2. Job Throws Error (without calling reject)

When a job throws an exception without calling `reject()`:

```typescript
async (args, reject) => {
  const response = await callLLM(args.modelId); // Makes API call
  await someOtherOperation(); // This throws!
  return { data: response, ... };
}
```

**Behavior:**
- **Capacity is NOT released** for time-windowed limits (TPM, RPM, TPD, RPD)
- Memory and concurrency slots ARE released (in finally block)
- Distributed backend is notified with ZERO usage

**Rationale:** We cannot know if the LLM API was called before the error. The user's code may have consumed tokens before crashing. Releasing capacity would cause under-counting. The time window will naturally reset, and capacity will be restored.

**User Mitigation:** If the user knows the actual usage at the point of failure, they should call `reject(usage)` before throwing or instead of throwing.

#### 3. Job Calls reject(usage)

When a job explicitly calls `reject()` with actual usage:

```typescript
async (args, reject) => {
  try {
    const response = await callLLM(args.modelId);
    // ... processing fails ...
  } catch (error) {
    // User knows they used tokens before failing
    reject({
      requestCount: 1,
      inputTokens: 3000,
      outputTokens: 0,
      cachedTokens: 500,
    }, { delegate: true });
    return dummyResult; // Required to satisfy type, but ignored
  }
}
```

**Behavior:**
- Actual usage is extracted from the `reject()` call
- **Same adjustment flow as successful job completion:**
  - Local rate limiters are adjusted based on actual vs estimated
  - Distributed backend is notified with actual usage
  - Memory and concurrency slots are released
- Job may delegate to next model (if `delegate: true`) or fail entirely

**Rationale:** The user explicitly provides actual usage, so we trust it and adjust all systems accordingly. This allows proper capacity tracking even for failed jobs.

### The reject() Callback API

```typescript
reject(usage: RejectUsage, opts?: JobRejectOptions): void

interface RejectUsage {
  /** Actual number of LLM API calls made before rejection */
  requestCount: number;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens consumed */
  outputTokens: number;
  /** Number of cached tokens consumed */
  cachedTokens: number;
}

interface JobRejectOptions {
  /** If true (default), delegate to next available model. If false, fail immediately. */
  delegate?: boolean;
}
```

**Important:** The `requestCount` field is required to properly adjust request-based limits (RPM, RPD). If the job made 2 API calls before failing, `requestCount` should be 2.

## Time-Window Rules

Different limit types have different time-sensitivity:

### Time-Windowed Limits (TPM, RPM, TPD, RPD)

- These limits reset at window boundaries (minute, day)
- Adjustment is **ONLY valid if the job finishes within the same time window it started**
- If a job started in minute 10 but finished in minute 11, the capacity was already "released" when the window reset
- Adjusting minute 11's capacity for minute 10's usage would be incorrect

### Non-Time-Windowed Limits (concurrent, memory)

- These limits have no time boundary - they reflect current state
- Always adjust immediately when a job completes
- No time-window considerations apply

## Example Scenarios

### Scenario 1: Same-Window Completion (TPM)

```
Window: Minute 10
Job starts: reserves 10,000 tokens
Job completes: used 6,000 tokens
Time: Still minute 10
→ Refund 4,000 tokens to minute 10's capacity
```

### Scenario 2: Cross-Window Completion (TPM)

```
Window: Minute 10
Job starts: reserves 10,000 tokens
Job completes: used 6,000 tokens
Time: Now minute 11
→ NO refund (minute 10's limits already reset)
```

### Scenario 3: Concurrent Limit

```
Job starts: reserves 1 concurrent slot
Job completes: releases 1 concurrent slot
→ Always release immediately (no time-window consideration)
```

### Scenario 4: Job Error Without reject() (TPM)

```
Window: Minute 10
Job starts: reserves 10,000 tokens
Job makes API call: uses 5,000 tokens
Job crashes (unrelated error)
Time: Still minute 10
→ NO adjustment (we don't know if API was called)
→ Minute 10's counter still shows 10,000 reserved
→ When minute 11 starts, counter resets naturally
```

### Scenario 5: Job Calls reject() (TPM)

```
Window: Minute 10
Job starts: reserves 10,000 tokens
Job makes API call: uses 5,000 tokens
Job detects error, calls reject({ requestCount: 1, inputTokens: 3000, outputTokens: 2000, cachedTokens: 0 })
Time: Still minute 10
→ Adjust counter: was 10,000 reserved, actual is 5,000
→ Refund 5,000 tokens to minute 10's capacity
→ Job delegates to next model (or fails if delegate: false)
```

### Scenario 6: Overage (TPM)

```
Window: Minute 10
Job starts: reserves 10,000 tokens
Job completes: used 15,000 tokens
Time: Still minute 10
→ Add overage: 15,000 - 10,000 = 5,000 tokens added to counter
→ Counter now shows actual usage (15,000)
→ onOverage callback invoked with overage details
```

## Design Decisions

### 1. Accurate Counting Model

The system should **accurately count actual usage**, both underages (refunds) and overages (additions).

**Rationale:**
- If actual < estimated: Refund unused capacity to allow other jobs to use it
- If actual > estimated: Add overage to counters to maintain accurate rate limit tracking
- The counter should always reflect reality - what was actually consumed

**Why overages must be added:**
- If we reserve 1000 tokens but use 1500, and don't add the extra 500, we're under-counting
- Under-counting means we might allow more jobs than the rate limit permits
- The rate limit exists to protect against API rate limit errors - accurate counting is essential

**Overage tracking for feedback:**
- In addition to adjusting counters, overages trigger `onOverage` callback
- This allows users to track estimation accuracy and tune estimates over time

### 2. Window Tracking via Job Metadata

Each job should carry metadata about which time window it started in.

**Rationale:**
- At completion time, the system needs to compare "start window" vs "current window"
- This metadata enables the same-window check for time-windowed limits
- Simple approach: store `windowStart` timestamp when job acquires capacity

### 3. Granular Adjustment per Limit Type

Adjustments should be made per limit type, not globally.

**Rationale:**
- A job might be within-window for minute limits but cross-window for day limits
- Each limit type operates independently
- Example: RPM refund valid, but TPD refund not valid (different window boundaries)

### 4. Local vs Distributed Adjustment

**Local Backend**: Adjustments happen immediately in-memory

**Distributed Backend**: Adjustments must be communicated to Redis

**Rationale:**
- Local adjustments are straightforward (in-memory counters)
- Distributed adjustments require atomic Redis operations
- Both backends should implement the same semantic behavior

### 5. Error Handling: Pessimistic by Default, Explicit Override via reject()

**Default behavior on error:** Do NOT release time-windowed capacity

**Rationale:**
- We cannot know if resources were consumed before the error
- User code may have called the LLM API, then crashed in unrelated code
- Releasing capacity would cause under-counting and potential rate limit violations
- Memory and concurrency ARE released (they reflect current state, not consumption)

**User override via reject():**
- If the user knows actual usage at failure point, they call `reject(usage)`
- This triggers the same adjustment flow as successful completion
- Gives users control while maintaining safety by default

### 6. reject() Must Include requestCount

The `reject()` callback requires `requestCount` (not optional).

**Rationale:**
- Request-based limits (RPM, RPD) need accurate request counts
- Token-only information is insufficient for complete adjustment
- A job might make multiple API calls before failing
- Example: Job makes 3 API calls, uses 5000 tokens total, then fails
  - Without requestCount: RPM counter unchanged (wrong - 3 requests were made)
  - With requestCount=3: RPM counter properly adjusted

### 7. Estimation Feedback Loop (Future Enhancement)

Track actual vs estimated usage patterns to improve future estimates.

**Rationale:**
- If a job type consistently uses 60% of its estimate, future estimates could be adjusted
- This is a separate feature from immediate capacity adjustment
- Scope: out of band for this design, noted for future consideration

## Behavior Summary

### By Limit Type

| Limit Type | Time-Sensitive | Adjustment Rule |
|------------|----------------|-----------------|
| TPM (tokens/minute) | Yes | Adjust (refund or add) only if same minute |
| RPM (requests/minute) | Yes | Adjust (refund or add) only if same minute |
| TPD (tokens/day) | Yes | Adjust (refund or add) only if same day |
| RPD (requests/day) | Yes | Adjust (refund or add) only if same day |
| maxConcurrentRequests | No | Always release on completion |
| memory | No | Always release on completion |

### By Completion Scenario

| Scenario | Time-Windowed Limits | Concurrency/Memory | Backend | Overage Callback |
|----------|---------------------|-------------------|---------|------------------|
| Job succeeds | Adjust with actual | Release | Release with actual | Yes, if actual > estimated |
| Job throws (no reject) | Keep estimated locked | Release | Release with ZERO | No |
| Job calls reject(usage) | Adjust with actual | Release | Release with actual | Yes, if actual > estimated |

## Success Criteria

1. Capacity is adjusted (refund or add) when actual differs from estimated AND within same time window
2. No adjustment occurs when job crosses time-window boundary (time-windowed limits only)
3. Non-time-windowed limits (memory, concurrency) always release immediately
4. Counters accurately reflect actual consumption (no under-counting or over-counting)
5. Distributed and local backends behave consistently
6. Jobs that throw without reject() do NOT release time-windowed capacity (safety)
7. Jobs that call reject(usage) trigger full adjustment flow with provided usage
8. Overage events are emitted when actual > estimated

## Open Questions

1. **Automatic re-estimation?** If a job consistently uses more than estimated, should the system automatically adjust future estimates for that job type? Current answer: No automatic adjustment, but `onOverage` callback provides data for user-driven adjustments.

2. **Partial refunds for partial window overlap?** If a job runs for 90 seconds (crossing one minute boundary), should we refund proportionally? Current answer: No - simpler to use start-window-only rule.

3. **Metrics and observability?** Should we track refund frequency, overage frequency, and capacity efficiency for monitoring? Current answer: `onOverage` callback provides basic observability; comprehensive metrics are future work.

## Resolved Questions

1. **Should overages be added to counters?** YES - counters must reflect actual usage to maintain rate limit accuracy. Overages are added to ensure we don't under-count.

2. **What happens when a job errors?** Depends on whether `reject()` was called:
   - Without reject(): Time-windowed capacity NOT released (pessimistic, safe)
   - With reject(usage): Full adjustment using provided usage (explicit override)
