# Actual Usage Adjustment - Design Document

## Overview

This document describes the design for adjusting capacity based on actual resource consumption after a job completes, rather than relying solely on estimates.

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
| Actual > Estimated | **Note the overage** for future estimation improvements (no penalty, already consumed) |
| Actual = Estimated | No adjustment needed |

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

## Design Decisions

### 1. Refund-Only Model

The system should **only refund unused capacity**, not penalize overages.

**Rationale:**
- Overages have already consumed the resource - the damage is done
- Penalizing overages would create negative capacity, breaking the system
- Overages should be tracked for improving future estimates, not for immediate adjustment

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

### 5. Estimation Feedback Loop (Future Enhancement)

Track actual vs estimated usage patterns to improve future estimates.

**Rationale:**
- If a job type consistently uses 60% of its estimate, future estimates could be adjusted
- This is a separate feature from immediate capacity adjustment
- Scope: out of band for this design, noted for future consideration

## Behavior Summary

| Limit Type | Time-Sensitive | Adjustment Rule |
|------------|----------------|-----------------|
| TPM (tokens/minute) | Yes | Refund only if same minute |
| RPM (requests/minute) | Yes | Refund only if same minute |
| TPD (tokens/day) | Yes | Refund only if same day |
| RPD (requests/day) | Yes | Refund only if same day |
| maxConcurrentRequests | No | Always release on completion |
| memory | No | Always release on completion |

## Success Criteria

1. Capacity is refunded when actual < estimated AND within same time window
2. No refund occurs when job crosses time-window boundary
3. Non-time-windowed limits always release immediately
4. No negative capacity states can occur
5. Distributed and local backends behave consistently

## Open Questions

1. **Should overages trigger re-estimation?** If a job consistently uses more than estimated, should the system automatically adjust future estimates for that job type?

2. **Partial refunds for partial window overlap?** If a job runs for 90 seconds (crossing one minute boundary), should we refund proportionally? Current design says no - simpler to use start-window-only rule.

3. **Metrics and observability?** Should we track refund frequency, overage frequency, and capacity efficiency for monitoring?
