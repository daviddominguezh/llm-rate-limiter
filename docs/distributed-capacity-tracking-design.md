# Distributed Actual Usage Tracking - Design Document

## Overview

This document specifies how actual resource usage is tracked and propagated across instances in a distributed rate limiting system to ensure global limits are respected.

## Problem Statement

In a distributed system with multiple instances sharing a global rate limit:
- Instance A is allocated 50,000 TPM (of 100,000 global)
- Instance B is allocated 50,000 TPM (of 100,000 global)

If Instance A's jobs consistently use MORE than estimated:
- A uses 56,000 TPM actual (6,000 over allocation)
- B uses 50,000 TPM actual (within allocation)
- **Global actual: 106,000 TPM (exceeds 100,000 limit)**

The system must propagate actual usage information so that when one instance overuses, other instances reduce their consumption to maintain the global limit.

## Design Goals

1. **Global Limit Enforcement**: Combined actual usage across all instances must not exceed configured limits
2. **Fair Rebalancing**: When one instance overuses, capacity is reduced proportionally from others
3. **Time-Window Awareness**: Usage tracking respects window boundaries (minute for TPM/RPM, day for TPD/RPD)
4. **Consistency**: Local and distributed layers agree on available capacity

## Architecture

### Communication Channel

All instance coordination uses a single Redis Pub/Sub channel:

```
{prefix}channel:allocations
```

### Notification Triggers

| Event | Action |
|-------|--------|
| Instance registration | Recalculate and broadcast allocations |
| Instance unregistration | Recalculate and broadcast allocations |
| Slot release (job completion) | Update global usage, recalculate, broadcast |
| Cleanup (stale instance removed) | Recalculate and broadcast allocations |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                              REDIS                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Slot Allocations (per instance)                            │    │
│  │  - instanceCount, slotsByJobTypeAndModel                    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Global Usage Tracking (per model, per time window)         │    │
│  │  - actualTokensThisMinute: 56,000                           │    │
│  │  - actualRequestsThisMinute: 23                             │    │
│  │  - actualTokensToday: 1,200,000                             │    │
│  │  - windowStart: 1707000000000                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                    ┌─────────┴─────────┐                            │
│                    │  Pub/Sub Channel  │                            │
│                    │  (allocations)    │                            │
│                    └─────────┬─────────┘                            │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │Instance A│    │Instance B│    │Instance C│
        │          │    │          │    │          │
        │ Reports: │    │ Receives:│    │ Receives:│
        │ +6000 TPM│    │ -3000 TPM│    │ -3000 TPM│
        │ overage  │    │ reduction│    │ reduction│
        └──────────┘    └──────────┘    └──────────┘
```

### Key Concepts

#### 1. Global Usage Counter

Redis maintains a global counter per model per time window:

```
{prefix}:usage:{modelId}:{windowType}:{windowStart}
```

Fields:
- `actualTokens`: Sum of actual tokens used by all instances
- `actualRequests`: Sum of actual requests made by all instances

#### 2. Usage Reporting

When a job completes, the instance reports **actual usage**:

| Scenario | Effect on Global Counter |
|----------|--------------------------|
| Actual < Estimated | Counter increases by actual (refund handled locally) |
| Actual = Estimated | Counter increases by actual |
| Actual > Estimated | Counter increases by actual (overage propagated) |

#### 3. Remaining Capacity Calculation

```
remainingGlobalCapacity = globalLimit - globalActualUsage
remainingPerInstance = remainingGlobalCapacity / instanceCount
```

When global actual usage increases, remaining capacity decreases for ALL instances.

## Behavior

### Job Completion Flow

1. **Job completes** with actual usage (success or via `reject(usage)`)

2. **Instance reports to Redis**:
   ```
   release(context, { actual: { tokens, requests }, windowStarts })
   ```

3. **Redis updates global counters**:
   ```lua
   actualTokens = actualTokens + reportedTokens
   actualRequests = actualRequests + reportedRequests
   ```

4. **Redis recalculates allocations**:
   ```lua
   remainingTokens = globalTPM - actualTokensThisMinute
   tokensPerInstance = floor(remainingTokens / instanceCount)
   ```

5. **Redis broadcasts allocations** via Pub/Sub channel

6. **Instances update local limits** via `setRateLimits()`

### Window Reset Handling

When a time window resets:

1. Redis detects window boundary crossing (new `windowStart`)
2. Old window counters expire via TTL
3. New window starts with zero actual usage
4. All instances receive full allocations again

### Overage Scenarios

#### Scenario 1: Single Instance Overage

```
Initial: 2 instances, 100,000 TPM global, 50,000 TPM each

Instance A completes job:
  - Estimated: 5,000 tokens
  - Actual: 8,000 tokens

Redis updates:
  - Global actual: 0 + 8,000 = 8,000 TPM used
  - Remaining: 100,000 - 8,000 = 92,000 TPM
  - Per instance: 92,000 / 2 = 46,000 TPM available

Broadcast:
  - Instance A: 46,000 TPM remaining (was 50,000)
  - Instance B: 46,000 TPM remaining (was 50,000)
```

#### Scenario 2: Cumulative Overages

```
After 10 jobs on Instance A:
  - Total estimated: 50,000 tokens
  - Total actual: 56,000 tokens
  - Cumulative overage: +6,000 tokens

Redis state:
  - Global actual: 56,000 TPM used
  - Remaining: 100,000 - 56,000 = 44,000 TPM
  - Per instance: 44,000 / 2 = 22,000 TPM available

Instance B now has 22,000 TPM (not 50,000) because A overused.
```

#### Scenario 3: Mixed Usage Patterns

```
Instance A: Heavy overages (actual 60,000, estimated 50,000)
Instance B: Underages (actual 25,000, estimated 30,000)
Instance C: On target (actual 10,000, estimated 10,000)

Global actual: 60,000 + 25,000 + 10,000 = 95,000 TPM used
Remaining: 100,000 - 95,000 = 5,000 TPM
Per instance: 5,000 / 3 = 1,666 TPM available
```

## API Specification

### BackendReleaseContext

```typescript
interface BackendReleaseContext {
  instanceId: string;
  jobId: string;
  jobType: string;
  modelId: string;

  actual: {
    tokens: number;
    requests: number;
  };

  windowStarts: {
    tpmWindowStart?: number;
    rpmWindowStart?: number;
    tpdWindowStart?: number;
    rpdWindowStart?: number;
  };
}
```

### AllocationInfo

```typescript
interface AllocationInfo {
  instanceCount: number;
  slotsByJobTypeAndModel: Record<string, Record<string, ModelSlotAllocation>>;

  dynamicLimits: {
    [modelId: string]: {
      tokensPerMinute?: number;
      requestsPerMinute?: number;
      tokensPerDay?: number;
      requestsPerDay?: number;
    };
  };
}
```

## Redis Data Structures

### Global Usage Key (TPM/RPM)

```
Key: {prefix}:usage:{modelId}:tpm:{windowStart}
Type: Hash
Fields:
  - actualTokens: number
  - actualRequests: number
  - lastUpdate: timestamp

TTL: 2 minutes (auto-cleanup after window expires)
```

### Daily Usage Key (TPD/RPD)

```
Key: {prefix}:usage:{modelId}:tpd:{dayStart}
Type: Hash
Fields:
  - actualTokens: number
  - actualRequests: number
  - lastUpdate: timestamp

TTL: 25 hours (auto-cleanup after day expires)
```

## Lua Script Specification

### Release Script

```lua
-- Input: instanceId, jobId, jobType, modelId, actualTokens, actualRequests,
--        tpmWindowStart, rpmWindowStart, tpdWindowStart, rpdWindowStart

-- Update global usage for TPM
if tpmWindowStart then
  local usageKey = prefix .. ':usage:' .. modelId .. ':tpm:' .. tpmWindowStart
  redis.call('HINCRBY', usageKey, 'actualTokens', actualTokens)
  redis.call('HSET', usageKey, 'lastUpdate', timestamp)
  redis.call('EXPIRE', usageKey, 120)
end

-- Update global usage for RPM
if rpmWindowStart then
  local usageKey = prefix .. ':usage:' .. modelId .. ':rpm:' .. rpmWindowStart
  redis.call('HINCRBY', usageKey, 'actualRequests', actualRequests)
  redis.call('HSET', usageKey, 'lastUpdate', timestamp)
  redis.call('EXPIRE', usageKey, 120)
end

-- Update global usage for TPD
if tpdWindowStart then
  local usageKey = prefix .. ':usage:' .. modelId .. ':tpd:' .. tpdWindowStart
  redis.call('HINCRBY', usageKey, 'actualTokens', actualTokens)
  redis.call('HSET', usageKey, 'lastUpdate', timestamp)
  redis.call('EXPIRE', usageKey, 90000) -- 25 hours
end

-- Update global usage for RPD
if rpdWindowStart then
  local usageKey = prefix .. ':usage:' .. modelId .. ':rpd:' .. rpdWindowStart
  redis.call('HINCRBY', usageKey, 'actualRequests', actualRequests)
  redis.call('HSET', usageKey, 'lastUpdate', timestamp)
  redis.call('EXPIRE', usageKey, 90000)
end

-- Release slot and recalculate allocations
recalculateAllocations()
```

### Reallocation Logic

```lua
local function recalculateAllocations()
  for each model in models do
    -- Get current window's global actual usage
    local currentMinute = math.floor(timestamp / 60000) * 60000
    local tpmUsageKey = prefix .. ':usage:' .. modelId .. ':tpm:' .. currentMinute
    local actualTPM = tonumber(redis.call('HGET', tpmUsageKey, 'actualTokens')) or 0

    local rpmUsageKey = prefix .. ':usage:' .. modelId .. ':rpm:' .. currentMinute
    local actualRPM = tonumber(redis.call('HGET', rpmUsageKey, 'actualRequests')) or 0

    -- Calculate remaining capacity
    local remainingTPM = model.tokensPerMinute - actualTPM
    local remainingRPM = model.requestsPerMinute - actualRPM

    local tpmPerInstance = math.floor(math.max(0, remainingTPM) / instanceCount)
    local rpmPerInstance = math.floor(math.max(0, remainingRPM) / instanceCount)

    -- Calculate slots based on remaining capacity
    local tpmSlots = math.floor(tpmPerInstance / estimatedTokens * ratio)
    local rpmSlots = math.floor(rpmPerInstance / estimatedRequests * ratio)
    local slots = math.min(tpmSlots, rpmSlots)

    -- Build dynamic limits
    dynamicLimits[modelId] = {
      tokensPerMinute = tpmPerInstance,
      requestsPerMinute = rpmPerInstance,
      tokensPerDay = tpdPerInstance,
      requestsPerDay = rpdPerInstance
    }
  end

  -- Broadcast to all instances
  for each instance do
    local allocation = {
      instanceCount = instanceCount,
      slotsByJobTypeAndModel = slots,
      dynamicLimits = dynamicLimits
    }
    redis.call('PUBLISH', channel, cjson.encode({
      instanceId = instanceId,
      allocation = cjson.encode(allocation)
    }))
  end
end
```

## Instance Behavior

### On Receiving Allocation Update

```typescript
onAllocationUpdate(allocation: AllocationInfo) {
  // Update slot counts
  this.updateSlots(allocation.slotsByJobTypeAndModel);

  // Update local rate limits to match global remaining capacity
  for (const [modelId, limits] of Object.entries(allocation.dynamicLimits)) {
    this.rateLimiters[modelId].setRateLimits({
      tokensPerMinute: limits.tokensPerMinute,
      requestsPerMinute: limits.requestsPerMinute,
      tokensPerDay: limits.tokensPerDay,
      requestsPerDay: limits.requestsPerDay,
    });
  }
}
```

### On Job Completion

```typescript
async releaseCapacity(context: ReservationContext, actual: ActualUsage) {
  await this.backend.release({
    instanceId: this.instanceId,
    jobId: context.jobId,
    jobType: context.jobType,
    modelId: context.modelId,
    actual: {
      tokens: actual.inputTokens + actual.outputTokens + actual.cachedTokens,
      requests: actual.requestCount,
    },
    windowStarts: context.windowStarts,
  });
}
```

## Error Handling

### Job Errors Without reject()

When a job throws without calling `reject()`:
- **Do NOT report actual usage** (we don't know what was consumed)
- Release slot only
- Global counters unchanged (pessimistic, safe)

### Job Errors With reject(usage)

When a job calls `reject(usage)`:
- Report the provided actual usage to Redis
- Global counters updated based on provided usage
- Other instances receive adjusted allocations

## Success Criteria

1. **Global limit respected**: Sum of actual usage across all instances never exceeds global limit
2. **Fair distribution**: When one instance overuses, reduction is distributed across all instances
3. **Time-window correctness**: Usage is tracked per window, resets at boundaries
4. **Eventual consistency**: All instances converge to correct allocations within broadcast latency
5. **Graceful degradation**: If Redis is unavailable, instances fall back to local-only limits

## Performance Considerations

- **Redis writes per job**: 1 HINCRBY per job completion per active window type
- **Broadcast frequency**: On every release that changes global counters
- **TTL cleanup**: Automatic via Redis key expiration
- **Payload size**: Allocations include dynamicLimits per model
