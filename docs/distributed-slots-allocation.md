# Distributed Slots Design

## Overview

This document describes the Redis backend's slot allocation system, which uses a **pool-based approach** where Redis tracks capacity per-model and local instances distribute that capacity across job types.

## Two Layers of Capacity Enforcement

The rate limiter enforces capacity at two levels. Understanding the distinction is essential:

### Layer 1: Model-Level Slots (Redis Pool)

Redis divides each model's global capacity into per-instance pools:

- `totalSlots = floor(remainingCapacity / avgEstimatedResourcePerJob / instanceCount)`
- These are **concurrency slots** that recycle when a job completes
- The Redis acquire/release scripts track global in-flight counts

Model-level slots answer: *"Does this instance have room for another job on this model?"*

### Layer 2: Per-Model-Per-JobType Slots (Local JTM)

Each instance's JobTypeManager (JTM) further partitions capacity by job type using `calculateModelJobTypeSlots`. This function evaluates **five dimensions** and picks the most restrictive:

| Dimension | Window | Slot formula | Behavior on job finish |
|-----------|--------|-------------|----------------------|
| TPM | 60s (minute) | `floor(perInstanceTPM × ratio / estimatedTokens)` | Slot NOT freed (rate) |
| RPM | 60s (minute) | `floor(perInstanceRPM × ratio / estimatedRequests)` | Slot NOT freed (rate) |
| TPD | 86,400s (day) | `floor(perInstanceTPD × ratio / estimatedTokens)` | Slot NOT freed (rate) |
| RPD | 86,400s (day) | `floor(perInstanceRPD × ratio / estimatedRequests)` | Slot NOT freed (rate) |
| totalSlots | 0 (concurrency) | `floor(totalSlots × ratio / 1)` | Slot freed (concurrency) |

**Rate-based slots** (`windowMs > 0`): Tracked by a window counter that auto-resets lazily at the window boundary (`Math.floor(Date.now() / windowMs)`). A finishing job decrements `inFlight` but NOT the window counter — the rate capacity stays consumed until the window resets.

**Concurrency-based slots** (`windowMs === 0`): Tracked by `inFlight` counter. A finishing job frees the slot immediately.

**Tie-breaking**: When two dimensions yield the same slot count, the one with the larger `windowMs` wins (most restrictive tracking — daily over minute, rate-based over concurrency).

Per-model-per-jobType slots answer: *"Can this job type start another job on this model within the current rate/concurrency budget?"*

### How They Interact

Both layers must pass for a job to start:

1. **Model-level** (Redis): `pool[model].totalSlots > 0` → concurrency permit
2. **Per-model-per-jobType** (Local JTM): rate or concurrency check depending on winning dimension

### Practical Example

With `openai/gpt-5.2` at 500,000 TPM, 500 RPM, 2 instances, and "summary" jobs (ratio=0.3, 10,000 tokens, 1 request):

```
Per-instance pool from Redis:
  tokensPerMinute = 250,000    requestsPerMinute = 250

Per-model-per-jobType candidates for summary:
  TPM: floor(250,000 × 0.3 / 10,000) =  7 slots  (windowMs = 60,000)
  RPM: floor(250 × 0.3 / 1)          = 75 slots  (windowMs = 60,000)

Winner: TPM with 7 rate slots per minute window
```

- First 7 summary jobs start immediately on each instance (14 total)
- Job #15 cannot start: window counter is full (7/7) even though all 7 jobs may have already finished
- Job #15 waits until the next minute boundary, when the window counter lazily resets to 0
- After reset: job #15 starts on openai (not escalated to another model)

### Cross-Case Safety

When rate-based wins, `rateSlots <= concurrencySlots` by definition (rate was the min). Since every in-flight job was acquired in the current window, `inFlight <= windowAcquired`. Checking `windowAcquired < rateSlots` implicitly ensures concurrency is within bounds. No double-check needed.

### Signaling: How Waiters Wake Up

| Event | Signal path | JTM result |
|-------|-------------|------------|
| Job finishes (rate-limited) | `onModelCapacityRelease` → wake waiters | **FAIL** — window counter still full |
| Job finishes (concurrency-limited) | Same path | **PASS** — inFlight decremented |
| Minute/day boundary | Timer fires `notifyCapacityAvailable` | **PASS** — window counter lazily resets |
| New allocation from backend | `notifyAllModelLimiters` | **PASS** — new pool may increase slots |
| Ratio adjustment | `notifyAllModelLimiters` | **PASS** — more slots for this job type |

The wake-up on job finish is not wasted — it's needed for concurrency-limited dimensions and other job types. The window counter simply makes `hasCapacity` return false, so the waiter goes back to sleep.

## Architecture: Pool-Based Allocation

The system separates concerns between Redis (global coordination) and local instances (job type distribution):

| Concern | Handled By | Description |
|---------|------------|-------------|
| Model capacity | Redis | Global limits, fair instance division |
| Actual usage tracking | Redis | TPM/RPM/TPD/RPD counters per model |
| Instance coordination | Redis | Heartbeats, cleanup, reallocation |
| Job type ratios | Local | Dynamic adjustment based on load |
| Job type enforcement | Local | Which job types can use pool slots |

### Why Pool-Based?

Ratios are intentionally **local to each instance**:
- Each instance may have different traffic patterns
- Local adjustment allows each instance to optimize for its own workload
- Avoids thundering herd problems where all instances react simultaneously
- Dynamic ratio changes take effect immediately without Redis coordination

If Redis enforced per-job-type slots, local ratio adjustments would be ignored.

## Backend Components

1. **Instance Registry**: Tracks active instances with heartbeats
2. **Pool Allocation Hash**: Stores per-model slot pools per instance
3. **Global Usage Counters**: Tracks actual tokens/requests per model per time window
4. **Pub/Sub Channel**: Notifies instances when allocations change
5. **Lua Scripts**: Atomic operations for acquire/release/reallocation

## Allocation Structure

Redis sends per-model pools, not per-job-type slots:

```typescript
interface AllocationInfo {
  instanceCount: number;
  pools: {
    [modelId: string]: {
      totalSlots: number;        // This instance's share of model capacity
      tokensPerMinute: number;   // Remaining TPM / instanceCount
      requestsPerMinute: number;
      tokensPerDay: number;
      requestsPerDay: number;
    };
  };
  dynamicLimits?: DynamicLimits;  // For rate limiter updates
}
```

### Pool Calculation Formula

```
pool[model].totalSlots = floor((remainingCapacity / estimatedResourcePerJob) / instanceCount)
```

Where:
- `remainingCapacity`: Global limit minus global actual usage (from dynamicLimits)
- `estimatedResourcePerJob`: Weighted average or maximum across job types
- `instanceCount`: Number of active instances

## Local Distribution

Each instance receives its pool allocation and distributes across job types locally:

```
Instance receives: pool["gpt-4"].totalSlots = 10

Local ratios (managed by JobTypeManager):
  summary: 0.6
  chat: 0.4

Local slot allocation:
  summary: floor(10 * 0.6) = 6 slots
  chat: floor(10 * 0.4) = 4 slots
```

### When Ratios Change

```
JobTypeManager adjusts ratios based on load:
  summary: 0.6 → 0.8
  chat: 0.4 → 0.2

Local recalculation (instant, no Redis):
  summary: floor(10 * 0.8) = 8 slots
  chat: floor(10 * 0.2) = 2 slots

Redis is unaware - pool still has 10 slots.
Local layer decides job type distribution.
```

## Acquire/Release Flow

### Acquire (Two-Layer Check)

```
Job arrives for "summary" job type on "gpt-4" model:

1. MODEL-LEVEL CHECK (Redis):
   → pool[gpt-4].totalSlots > 0
   → Pass: decrement pool slot, increment model in-flight

2. PER-MODEL-PER-JOBTYPE CHECK (Local JTM):
   → calculateModelJobTypeSlots(pool, ratio, resources, minCapacity)
   → Returns { slots: 7, windowMs: 60000 }  (TPM won)
   → windowMs > 0, so check: windowCount < 7
   → Pass: 0 < 7

3. ACQUIRE COUNTERS:
   → Increment inFlight (always, for monitoring)
   → Increment window counter (only when windowMs > 0)

4. Job proceeds
```

### Release

```
Job completes with actual usage:

1. LOCAL JTM:
   → Decrement inFlight[model][summary] (always)
   → Window counter is NOT decremented (rate capacity stays consumed)
   → Fire onModelCapacityRelease (wakes waiters, but JTM check may reject)

2. REDIS: backend.release({
     instanceId, modelId,
     actual: { tokens, requests },
     windowStarts: { tpmWindowStart, ... }
   })

3. REDIS updates global usage counters

4. REDIS recalculates pools for all instances

5. Pub/Sub broadcasts new allocations
```

### Lua Script Behavior

**ACQUIRE_SCRIPT**:
- Input: `instanceId`, `modelId` (no job type)
- Checks: `pool[model].totalSlots > 0`
- Action: Decrement pool slot, increment in-flight

**RELEASE_SCRIPT**:
- Input: `instanceId`, `modelId`, `actual`, `windowStarts`
- Action: Update global usage counters, trigger reallocation

## Dynamic Ratio System (Local Per-Instance)

### Ratio Configuration

Job types can be **flexible** or **fixed**:

```typescript
interface JobTypeRatioConfig {
  initialValue?: number;  // Initial ratio (0-1), all must sum to 1
  flexible?: boolean;     // Can ratio be adjusted? Default: true
}
```

Example:
```typescript
const resourceEstimations = {
  summary: {
    estimatedUsedTokens: 10000,
    ratio: { initialValue: 0.3 },  // Flexible by default
  },
  VacationPlanning: {
    estimatedUsedTokens: 2000,
    ratio: { initialValue: 0.4, flexible: false },  // FIXED
  },
};
```

### Adjustment Algorithm

The `JobTypeManager.adjustRatios()` method:

1. **Identify Donors**: Flexible job types with load < 30% (underutilized)
2. **Identify Receivers**: Flexible job types with load > 70% (overutilized)
3. **Calculate Contributions**: Donors contribute proportional to their underutilization
4. **Transfer Capacity**: Receivers get capacity proportional to their load level
5. **Normalize Ratios**: Ensure all ratios sum to 1
6. **Recalculate Local Slots**: Apply ratios to pool allocations

### Adjustment Triggers

- **Periodically**: Every 5 seconds (configurable via `adjustmentIntervalMs`)
- **On Release**: After every 10 job completions (configurable via `releasesPerAdjustment`)

### Configuration

```typescript
interface RatioAdjustmentConfig {
  highLoadThreshold?: number;      // Default: 0.7 (70%)
  lowLoadThreshold?: number;       // Default: 0.3 (30%)
  maxAdjustment?: number;          // Default: 0.2 (20% max change per cycle)
  minRatio?: number;               // Default: 0.01 (1% minimum)
  adjustmentIntervalMs?: number;   // Default: 5000 (5 seconds)
  releasesPerAdjustment?: number;  // Default: 10
}
```

### Example Flow

**Initial State** (pool has 100 slots):
- JobA (flexible): ratio=0.3 → 30 local slots, 5 in-flight (16.7% load)
- JobB (flexible): ratio=0.4 → 40 local slots, 38 in-flight (95% load)
- JobC (fixed): ratio=0.3 → 30 local slots, 10 in-flight (33% load)

**After Local Adjustment**:
- JobA: 16.7% < 30% → **DONOR**
- JobB: 95% > 70% → **RECEIVER**
- JobC: Fixed → **UNCHANGED**

**Result** (pool still has 100 slots):
- JobA: ratio=0.133 → 13 local slots
- JobB: ratio=0.567 → 56 local slots
- JobC: ratio=0.3 → 30 local slots (unchanged)

## Pub/Sub Messages

Allocation change notifications include pool breakdown:

```json
{
  "instanceId": "instance-1",
  "allocation": {
    "instanceCount": 2,
    "pools": {
      "gpt-4": {
        "totalSlots": 50,
        "tokensPerMinute": 500000,
        "requestsPerMinute": 250,
        "tokensPerDay": 5000000,
        "requestsPerDay": 2500
      },
      "claude-3": {
        "totalSlots": 30,
        "tokensPerMinute": 300000,
        "requestsPerMinute": 150,
        "tokensPerDay": 3000000,
        "requestsPerDay": 1500
      }
    },
    "dynamicLimits": {
      "gpt-4": { "tokensPerMinute": 500000, ... },
      "claude-3": { "tokensPerMinute": 300000, ... }
    }
  }
}
```

## Information Boundaries

### What Redis Knows
- Active instances (for fair division)
- Global actual usage per model (TPM, RPM, TPD, RPD)
- Per-model capacity limits
- Instance heartbeats and in-flight counts

### What Redis Does NOT Know
- Job type ratios
- Per-job-type slot counts
- Local load distribution decisions

### What Local Instance Knows
- Its pool allocation per model
- Its local ratios per job type
- Its local in-flight counts per job type

## Edge Cases

### Floor Rounding Gives Zero Slots

```
Pool: 2 slots, jobTypeA ratio: 0.3
floor(2 * 0.3) = 0 slots

Mitigation: Local manager guarantees minJobTypeCapacity (default: 1)
```

### Ratio Sum Exceeds 1.0

```
After aggressive adjustment:
  jobTypeA: 0.7, jobTypeB: 0.5 (total: 1.2)

floor(5 * 0.7) = 3
floor(5 * 0.5) = 2
Total: 5 (matches pool)

Result: Floor function naturally handles this.
```

### All Job Types Want Same Model

```
Pool: 5 slots
jobTypeA wants 4, jobTypeB wants 4

First 5 jobs (any type) get slots.
Remaining jobs wait in local queue.
```

## Design Invariants

1. **Pool Sum**: `sum(instance.pool[model].slots) <= globalCapacity / estimatedResource`
2. **Local Ratio Sum**: `sum(localRatio[jobType]) ≈ 1.0`
3. **Rate Capacity**: When rate-based dimension wins, `windowCount[model][jobType] <= slots` within the current window
4. **Concurrency Capacity**: When concurrency-based dimension wins, `inFlight[model][jobType] <= slots`
5. **Cross-case safety**: `inFlight <= windowCount` always (every in-flight job was acquired in this window)
6. **Global Usage**: `sum(instance.actualUsage) == globalActualUsage`

## Design Principles

1. **Single Source of Truth**
   - Ratios: Local JobTypeManager only
   - Model capacity: Redis only

2. **Separation of Concerns**
   - Redis: Global coordination, fair instance division, actual usage tracking
   - Local: Ratio management, job type distribution, queue management

3. **Acquire Still Goes to Redis**
   - Prevents over-allocation across instances
   - Tracks global in-flight for fair distribution

4. **No Job Type in Redis**
   - Clean separation of concerns
   - Simpler Lua scripts
   - Local ratio changes work immediately
