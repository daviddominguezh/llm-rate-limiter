# Distributed Slots Design

## Overview

This document describes the Redis backend's slot allocation system, which uses a **pool-based approach** where Redis tracks capacity per-model and local instances distribute that capacity across job types.

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

1. LOCAL CHECK: "Do I have summary capacity?"
   → inFlight[summary] < localSlots[summary]
   → Pass: 0 < 8

2. REDIS CHECK: "Can I use 1 slot from gpt-4 pool?"
   → backend.acquire(instanceId, modelId)
   → Pass: pool[gpt-4].totalSlots > 0
   → Decrement pool slot

3. Job proceeds
```

### Release

```
Job completes with actual usage:

1. LOCAL: Decrement inFlight[summary]

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
3. **In-Flight Constraint**: `inFlight[jobType] <= floor(pool.slots * ratio[jobType])`
4. **Global Usage**: `sum(instance.actualUsage) == globalActualUsage`

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
