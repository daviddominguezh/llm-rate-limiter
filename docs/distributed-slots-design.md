# Distributed Slots Design

## Overview

This document describes the current behavior of the Redis backend's slot allocation system and the required changes to support proper per-job-type per-model capacity calculation.

## Current Implementation

### Backend Architecture

The Redis backend coordinates capacity across multiple server instances using:

1. **Instance Registry**: Tracks all active instances with their `inFlight` request counts
2. **Allocation Hash**: Stores slot allocations per instance
3. **Pub/Sub Channel**: Notifies instances when allocations change
4. **Lua Scripts**: Atomic operations for acquire/release/reallocation

### Current Slot Calculation

The current system uses a single `totalCapacity` number calculated in `redisBackendFactory.ts`:

```typescript
const calculateTotalCapacity = (models: RedisBackendInitConfig['models']): number => {
  let totalCapacity = 0;
  const defaultCapacityPerModel = 100;
  for (const modelConfig of Object.values(models)) {
    const { maxConcurrentRequests } = modelConfig;
    totalCapacity += maxConcurrentRequests ?? defaultCapacityPerModel;
  }
  return totalCapacity;
};
```

**Problem**: This only considers `maxConcurrentRequests`. Models with TPM/RPM limits get a default of 100, which severely underestimates actual capacity.

### Allocation Algorithm (Lua)

The `REALLOCATION_LOGIC` in `luaScripts.ts` distributes slots using fair-share:

```lua
local fairShare = math.floor(totalCapacity / instanceCount)
local available = math.max(0, totalCapacity - totalInFlight)

for _, n in ipairs(needs) do
  local allocation = math.floor((n.need / totalNeed) * available)
  -- Store single 'slots' number per instance
  redis.call('HSET', allocationsKey, n.id, cjson.encode({
    slots=allocation,
    instanceCount=instanceCount
  }))
end
```

### Acquire/Release Flow

1. **Acquire** (`ACQUIRE_SCRIPT`):
   - Checks if instance has `slots > 0`
   - Decrements `slots`, increments `inFlight`
   - Returns "0" if no slots available (job rejected)

2. **Release** (`RELEASE_SCRIPT`):
   - Decrements `inFlight`
   - Triggers reallocation to redistribute freed capacity

### Why This Fails

With the test configuration:
- openai: TPM-limited (no concurrent limit) → defaultCapacity = 100
- xai: TPM-limited (no concurrent limit) → defaultCapacity = 100
- deepinfra: maxConcurrentRequests = 200

**Result**: `totalCapacity = 400`

When 400 slots are exhausted globally, the backend rejects all new jobs even though:
- deepinfra might have 150+ concurrent slots available locally
- openai/xai might have TPM capacity remaining

The single `slots` number cannot represent the multi-dimensional capacity reality.

## Required Behavior

### Design Principles

1. **Job Types Are Static**: Job types are defined upfront at configuration time, not dynamically registered.

2. **Slots Are Hard Limits**: Slots must be calculated with extreme accuracy. They are not soft guidance—they represent actual capacity that the system guarantees.

3. **Real Usage Adjustment**: After a job completes, the system adjusts capacity based on actual resource consumption (not just estimates). Time-window considerations apply:
   - **Time-windowed limits (TPM, RPM)**: Only adjust if still within the same time window. If a job started in minute 10 but finished in minute 11, do NOT adjust minute 11's capacity (limits were reset).
   - **Non-time-windowed limits (concurrent, memory)**: Always update immediately, as these are not time-window dependent.

4. **Dynamic Ratios**: Ratios are not fixed—they adjust automatically based on LOCAL load (see Dynamic Ratio System below). Ratios are intentionally local to each instance, not synchronized across instances.

### Multi-Dimensional Capacity

Capacity must be tracked across these dimensions:
- **Per Model**: Each model has different limits (TPM, RPM, concurrent)
- **Per Job Type**: Different jobs consume different resources
- **Per Instance**: Fair distribution across server instances

### Slot Calculation Formula

```
slots[jobType][model] = (modelCapacity / estimatedResourcePerJob) / instanceCount * jobTypeRatio
```

Where:
- `modelCapacity`: The limiting factor for this model (TPM, RPM, or concurrent)
- `estimatedResourcePerJob`: Expected resource consumption for this job type on this model
- `instanceCount`: Number of active instances (from backend)
- `jobTypeRatio`: Current ratio for this job type (dynamic, based on load)

### Example Calculation

**Configuration:**
- 2 job types: `summary` (ratio: 0.7), `fill` (ratio: 0.3)
- 2 models:
  - `openai`: 1M TPM, ~5000 tokens/job → 200 slots base
  - `deepinfra`: 200 concurrent
- 2 instances

**Calculation:**

| Job Type | Model     | Base Capacity | / Instances | × Ratio | = Slots |
|----------|-----------|---------------|-------------|---------|---------|
| summary  | openai    | 200           | 100         | 0.7     | 70      |
| summary  | deepinfra | 200           | 100         | 0.7     | 70      |
| fill     | openai    | 200           | 100         | 0.3     | 30      |
| fill     | deepinfra | 200           | 100         | 0.3     | 30      |

### AllocationInfo Structure

The allocation structure provides per-job-type per-model slot breakdown:

```typescript
interface AllocationInfo {
  instanceCount: number;
  slotsByJobTypeAndModel: {
    [jobType: string]: {
      [modelId: string]: {
        slots: number;
        tokensPerMinute: number;
        requestsPerMinute: number;
      };
    };
  };
}
```

### onAvailableSlotsChange Callback

The callback must provide per-job-type per-model breakdown so clients can:
1. Display accurate availability to users
2. Make informed decisions about which jobs to accept
3. Implement proper backpressure

```typescript
onAvailableSlotsChange: (info: AllocationInfo) => void;
```

## Dynamic Ratio System (Local Per-Instance)

The system supports dynamic ratio adjustment based on load. **Ratios are intentionally LOCAL to each instance** — they are not synchronized across instances via Redis.

**Why local ratios?**
- Each instance may have different traffic patterns (e.g., Instance A serves Product A, Instance B serves Product B)
- Local adjustment allows each instance to optimize for its own workload
- Avoids thundering herd problems where all instances react simultaneously
- Simpler, faster, more resilient (no Redis dependency for ratio changes)
- The distributed part (fair capacity division) already happens at the slot allocation level via `instanceCount`

### Ratio Configuration

Job types can be configured as **flexible** or **fixed** via `JobTypeRatioConfig`:

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

### Load Measurement

Load is measured as percentage of allocated slots:

```typescript
loadPercentage = inFlight / allocatedSlots
```

### Adjustment Algorithm

The `JobTypeManager.adjustRatios()` method:

1. **Identify Donors**: Flexible job types with load < 30% (underutilized)
2. **Identify Receivers**: Flexible job types with load > 70% (overutilized)
3. **Calculate Contributions**: Donors contribute proportional to their underutilization
4. **Transfer Capacity**: Receivers get capacity proportional to their load level
5. **Normalize Ratios**: Ensure all ratios sum to 1
6. **Recalculate Slots**: Update `allocatedSlots` for each job type

### Adjustment Triggers

Ratios are recalculated:
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

**Initial State** (100 total slots):
- JobA (flexible): ratio=0.3 → 30 slots, 5 in-flight (16.7% load)
- JobB (flexible): ratio=0.4 → 40 slots, 38 in-flight (95% load)
- JobC (fixed): ratio=0.3 → 30 slots, 10 in-flight (33% load)

**After Adjustment**:
- JobA: 16.7% < 30% → **DONOR**, contributes capacity
- JobB: 95% > 70% → **RECEIVER**, gets capacity
- JobC: Fixed → **UNCHANGED**

**Result**:
- JobA: ratio=0.133 → 13 slots
- JobB: ratio=0.567 → 56 slots
- JobC: ratio=0.3 → 30 slots (unchanged)

### Impact on Local Slot Calculation

When ratios change locally on an instance:
1. The instance's `JobTypeManager` recalculates local slot allocations
2. The `availabilityTracker` is notified via callback
3. Local availability is updated immediately
4. **No Redis communication occurs** — ratios are purely local

The distributed backend only tracks:
- Instance count (for fair division of global capacity)
- In-flight requests (for coordination)
- Base slot allocations (before local ratio adjustment)

## Implementation Changes Required

### 1. Backend Configuration

The backend needs to know:
- All model IDs and their capacity limits (TPM, RPM, concurrent)
- All job types (defined upfront) and their initial ratios
- Resource estimation per job type per model

### 2. Lua Script Changes

**REGISTER_SCRIPT**: Store model/job-type configuration in Redis

**REALLOCATION_LOGIC**: Calculate slots per job-type per model:
```lua
for each jobType do
  for each model do
    local baseCapacity = calculateBaseCapacity(model)
    local slots = math.floor(
      (baseCapacity / instanceCount) * jobTypeRatio
    )
    -- Store in nested hash structure
  end
end
```

**ACQUIRE_SCRIPT**: Check specific job-type + model slot availability

**RELEASE_SCRIPT**:
- Release for specific job-type + model
- Decrement in-flight tracking
- Trigger reallocation to redistribute freed capacity

Note: Ratio adjustments are handled locally by each instance and do not require Redis scripts.

### 3. TypeScript Changes

- Update `AllocationInfo` type to include per-job-type per-model breakdown
- Update `RedisBackendInitConfig` to include job type configuration
- Update `availabilityTracker.ts` to use new structure
- Update callbacks to provide detailed breakdown
- `JobTypeManager` ratio changes remain local (no backend synchronization needed)

### 4. Pub/Sub Messages

Allocation change notifications include full breakdown:
```json
{
  "instanceId": "instance-1",
  "allocation": {
    "instanceCount": 2,
    "slotsByJobTypeAndModel": {
      "summary": {
        "openai": { "slots": 70, "tokensPerMinute": 500000, "requestsPerMinute": 0 },
        "deepinfra": { "slots": 70, "tokensPerMinute": 0, "requestsPerMinute": 250 }
      },
      "fill": {
        "openai": { "slots": 30, "tokensPerMinute": 500000, "requestsPerMinute": 0 },
        "deepinfra": { "slots": 30, "tokensPerMinute": 0, "requestsPerMinute": 250 }
      }
    }
  }
}
```

### 5. Ratio Management (Local Only)

Ratios are managed **locally** by each instance's `JobTypeManager`:
1. Each instance monitors its own load per job type
2. `JobTypeManager.adjustRatios()` recalculates ratios based on local load
3. Local slot allocations are updated immediately
4. No Redis synchronization occurs

This design allows each instance to optimize for its specific traffic pattern without global coordination overhead.

## Migration Path

1. Add new configuration fields (backward compatible)
2. Implement new Lua scripts alongside existing ones
3. Update TypeScript types with optional new fields
4. Migrate instances one at a time
5. Remove legacy single-slot logic once all instances updated
