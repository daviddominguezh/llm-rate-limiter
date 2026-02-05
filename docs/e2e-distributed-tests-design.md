# E2E Tests for Distributed Slots

This document describes the end-to-end test suites for verifying the pool-based slot allocation system in the distributed rate limiter.

## Overview

The distributed slots feature implements a **pool-based** slot allocation system:

- **Redis** calculates per-model pools: `pools[model].totalSlots = floor(modelCapacity / estimatedResourcePerJob / instanceCount)`
- **Local instances** distribute pool slots across job types using ratios

This separation allows dynamic ratio adjustments without Redis round-trips.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                            REDIS                                 │
│                                                                  │
│  Tracks per-model pools only (no job type awareness):           │
│  pools['model-alpha'] = { totalSlots: 10, tokensPerMinute: 50K } │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │Instance A│    │Instance B│    │Instance C│
        │          │    │          │    │          │
        │ Local    │    │ Local    │    │ Local    │
        │ JobType  │    │ JobType  │    │ JobType  │
        │ Manager  │    │ Manager  │    │ Manager  │
        │          │    │          │    │          │
        │ Ratios:  │    │ Ratios:  │    │ Ratios:  │
        │ A: 0.6   │    │ A: 0.5   │    │ A: 0.7   │
        │ B: 0.4   │    │ B: 0.5   │    │ B: 0.3   │
        └──────────┘    └──────────┘    └──────────┘
```

Each instance can have different local ratios (due to different load patterns), but they all share the same per-model pool allocation from Redis.

## Test Configuration Presets

Tests use different configuration presets defined in `packages/e2e/serverInstance/src/rateLimiterConfigs.ts`:

### Core Presets

| Preset            | Models                      | Job Types                           | Purpose                          |
| ----------------- | --------------------------- | ----------------------------------- | -------------------------------- |
| `default`         | 3 (openai, xai, deepinfra)  | 5 (summary, VacationPlanning, etc.) | Original production-like config  |
| `slotCalculation` | 2 (model-alpha, model-beta) | 2 (jobTypeA, jobTypeB)              | Simple verifiable slot math      |
| `fixedRatio`      | 1 (test-model)              | 3 (fixedJobType, flexibleJobTypeA, flexibleJobTypeB) | Fixed vs flexible ratio behavior |
| `flexibleRatio`   | 1 (flex-model)              | 3 (flexJobA, flexJobB, flexJobC)    | Dynamic ratio adjustment         |
| `instanceScaling` | 1 (scale-model)             | 1 (scaleJob)                        | Instance join/leave behavior     |

### Slot Calculation Presets (for testing specific limit types)

| Preset                   | Model Limits                | Job Types                    | Purpose                          |
| ------------------------ | --------------------------- | ---------------------------- | -------------------------------- |
| `slotCalc-tpm`           | TPM only (100K)             | 2 (jobTypeA, jobTypeB)       | TPM-based slot calculation       |
| `slotCalc-rpm`           | RPM only (500)              | 2 (jobTypeA, jobTypeB)       | RPM-based slot calculation       |
| `slotCalc-tpd`           | TPD only (1M)               | 2 (jobTypeA, jobTypeB)       | TPD-based slot calculation       |
| `slotCalc-rpd`           | RPD only (10K)              | 2 (jobTypeA, jobTypeB)       | RPD-based slot calculation       |
| `slotCalc-concurrent`    | maxConcurrent only (100)    | 2 (jobTypeA, jobTypeB)       | Concurrency-based calculation    |
| `slotCalc-tpm-rpm`       | TPM (100K) + RPM (50)       | 2 (jobTypeA, jobTypeB)       | Mixed limits (limiting factor)   |
| `slotCalc-multi-model`   | model-tpm: TPM, model-concurrent: concurrent | 2 (jobTypeA, jobTypeB) | Different limit types per model  |
| `slotCalc-ratios`        | TPM (100K)                  | 3 (0.5, 0.3, 0.2 ratios)     | Various ratio combinations       |
| `slotCalc-uneven-ratios` | TPM (100K)                  | 4 (0.7, 0.1, 0.1, 0.1 ratios)| Uneven ratio distribution        |

---

## Test Suites (Ordered by Complexity)

---

### 1. Slot Calculation (`slotCalculation.test.ts`)

**Complexity:** Low

**Purpose:** Check that the pool-based slot calculations work correctly with different model and instance combinations. This does not test load, does not queue any job, we only need to verify the initial pool allocation math works.

**Approach:**
1. Reset instances with a specific config preset
2. Query the allocation endpoint (`GET /api/debug/allocation`) from each instance
3. Verify `pools[modelId].totalSlots` against mathematically calculated expected values
4. Repeat for multiple config presets covering all limit type combinations

**Pool Calculation Formula:**

```
For TPM-limited models:
  pools[model].totalSlots = floor((TPM / estimatedTokens) / instanceCount)
  pools[model].tokensPerMinute = TPM / instanceCount

For RPM-limited models:
  pools[model].totalSlots = floor((RPM / estimatedRequests) / instanceCount)
  pools[model].requestsPerMinute = RPM / instanceCount

For concurrent-limited models:
  pools[model].totalSlots = floor(maxConcurrent / instanceCount)

For mixed limits:
  pools[model].totalSlots = min(tpm_slots, rpm_slots, concurrent_slots, ...)
```

**Note:** Job type ratios are NOT part of Redis pool calculation. Ratios are applied locally by each instance's JobTypeManager.

#### Test Case 1: TPM-Only Model (`slotCalc-tpm`)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 5,000, ratio = 0.4
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-alpha'].totalSlots` | `floor((100K / 10K) / 2)` | 5 |
| `allocation.pools['model-alpha'].tokensPerMinute` | `100K / 2` | 50,000 |
| Local jobTypeA slots | `floor(5 * 0.6)` | 3 (managed locally) |
| Local jobTypeB slots | `floor(5 * 0.4)` | 2 (managed locally) |

#### Test Case 2: RPM-Only Model (`slotCalc-rpm`)

**Config:**
```
model-beta: RPM = 500
jobTypeA: estimatedRequests = 1, ratio = 0.6
jobTypeB: estimatedRequests = 5, ratio = 0.4
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-beta'].totalSlots` | `floor((500 / 1) / 2)` | 250 |
| `allocation.pools['model-beta'].requestsPerMinute` | `500 / 2` | 250 |

#### Test Case 3: Concurrent-Only Model (`slotCalc-concurrent`)

**Config:**
```
model-gamma: maxConcurrentRequests = 100
jobTypeA: ratio = 0.7
jobTypeB: ratio = 0.3
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-gamma'].totalSlots` | `floor(100 / 2)` | 50 |

#### Test Case 4: Mixed Limits - Limiting Factor (`slotCalc-tpm-rpm`)

**Config:**
```
model-delta: TPM = 100,000, RPM = 50
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1, ratio = 0.5
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| TPM-based slots | `floor((100K / 10K) / 2)` | 5 |
| RPM-based slots | `floor((50 / 1) / 2)` | 25 |
| `allocation.pools['model-delta'].totalSlots` | `min(5, 25)` | 5 (TPM is limiting) |

#### Test Case 5: Multiple Models (`slotCalc-multi-model`)

**Config:**
```
model-tpm: TPM = 100,000
model-concurrent: maxConcurrentRequests = 50
jobTypeA: estimatedTokens = 10,000, ratio = 0.5
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-tpm'].totalSlots` | `floor((100K / 10K) / 2)` | 5 |
| `allocation.pools['model-concurrent'].totalSlots` | `floor(50 / 2)` | 25 |

#### Test Case 6: Instance Count Variations

Run each config with 1, 2, and 3 instances to verify instance division:

| Instance Count | Pool Slot Division |
|----------------|-------------------|
| 1 instance | Full capacity |
| 2 instances | Half per instance |
| 3 instances | Third per instance |

**Key Verification:** The allocation endpoint returns mathematically correct pool slot values for ALL combinations of limit types and instance counts. Job type distribution is verified separately as a local concern.

---

### 2. Fixed Ratio Isolation (`fixedRatioIsolation.test.ts`)

**Complexity:** Low

**Purpose:** Check that if there are three job types, and one of them (fixedJobType) is not flexible, then filling the capacity of the flexible types should not alter the capacity of the fixed type.

**Config:** `fixedRatio`
```
test-model: 100K TPM
fixedJobType: 10K tokens/job, ratio 0.4, flexible: false
flexibleJobTypeA: 10K tokens/job, ratio 0.3, flexible: true
flexibleJobTypeB: 10K tokens/job, ratio 0.3, flexible: true
```

**Pool Calculation (2 instances):**
```
pools['test-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 per instance
```

**Local Distribution (per instance):**
```
fixedJobType:     floor(5 * 0.4) = 2 slots (protected)
flexibleJobTypeA: floor(5 * 0.3) = 1 slot (can adjust)
flexibleJobTypeB: floor(5 * 0.3) = 1 slot (can adjust)
```

#### Test Case 1: Fixed Job Type Maintains Capacity

| What We Check                | Expected Result                      |
| ---------------------------- | ------------------------------------ |
| fixedJobType completions     | All fixedJobType jobs complete       |
| flexibleJobTypeA completions | All flexibleJobTypeA jobs complete   |
| flexibleJobTypeB completions | All flexibleJobTypeB jobs complete   |
| Failed jobs                  | No jobs fail                         |

#### Test Case 2: Fixed Ratio Not Affected by Flexible Overload

| What We Check                                             | Expected Result                                      |
| --------------------------------------------------------- | ---------------------------------------------------- |
| fixedJobType completions when flexible types overloaded   | All fixedJobType jobs complete                       |
| fixedJobType queue duration                               | fixedJobType jobs complete quickly (< 2s queue time) |
| flexibleJobTypeA completions                              | All eventually complete (some wait for capacity)     |
| Failed jobs                                               | No jobs fail                                         |

**Key Verification:** Even when both flexible types are overloaded and rebalancing ratios between themselves, fixedJobType maintains its protected slots and cannot donate or receive capacity.

---

### 3. Slots Evolve With Load (`slotsEvolveWithLoad.test.ts`)

**Complexity:** Medium

**Purpose:** Check that the calculated slots evolve properly over time, when load increases and decreases.

**Config:** `slotCalculation`

#### Test Case 1: Sequential Acquire and Release

| What We Check                | Expected Result                                |
| ---------------------------- | ---------------------------------------------- |
| Batch 1 completions          | All complete                                   |
| Batch 2 completions          | All complete (reusing freed slots)             |
| Batch 1 queue duration       | Batch 1 completes quickly (immediate capacity) |
| Failed jobs                  | No jobs fail                                   |

**Key Verification:** After Batch 1 completes and frees slots, Batch 2 can immediately use those freed slots.

#### Test Case 2: Concurrent Load with Slot Reuse

| What We Check              | Expected Result           |
| -------------------------- | ------------------------- |
| Long jobs completions      | All long jobs complete    |
| Short jobs completions     | All short jobs complete   |
| Failed jobs                | No jobs fail              |

**Key Verification:** Short jobs wait while long jobs occupy slots, then acquire slots as long jobs complete.

---

### 4. Instance Scaling (`instanceScaling.test.ts`)

**Complexity:** Medium-High

**Purpose:** Check that if instance B joins AFTER instance A has joined, A's pool slots halve. Check that if instance B disconnects, A's pool slots double.

**Config:** `instanceScaling`
```
scale-model: 100K TPM
scaleJob: 10K tokens/job, ratio 1.0
```

**Pool Calculation:**
```
1 instance: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 1) = 10 slots
2 instances: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 slots per instance
3 instances: pools['scale-model'].totalSlots = floor((100,000 / 10,000) / 3) = 3 slots per instance
```

#### Test Case 1: Instance A Starts Alone

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance A | Instance A starts successfully |
| `allocation.pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` | 1 |

#### Test Case 2: Instance B Joins - A's Pool Slots Halve

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance B (while A running) | Instance B starts successfully |
| Query A's `allocation.pools['scale-model'].totalSlots` | 5 |
| Query B's `allocation.pools['scale-model'].totalSlots` | 5 |
| `allocation.instanceCount` on both | 2 |

#### Test Case 3: Instance B Leaves - A's Pool Slots Double

| What We Check | Expected Result |
|---------------|-----------------|
| Kill instance B | Instance B shuts down gracefully |
| Query A's `allocation.pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` on A | 1 |

**Key Verification:** Pool slots redistribute correctly through multiple join/leave cycles.

---

### 5. Flexible Ratio Adjustment (`flexibleRatioAdjustment.test.ts`)

**Complexity:** High

**Purpose:** Check that if there are several job types and they have flexible behavior, their ratios are adjusted locally depending on the load.

**Config:** `flexibleRatio`
```
flex-model: 100K TPM
flexJobA: 10K tokens/job, ratio ~0.33, flexible: true
flexJobB: 10K tokens/job, ratio ~0.33, flexible: true
flexJobC: 10K tokens/job, ratio ~0.33, flexible: true
```

**Pool Calculation (2 instances):**
```
pools['flex-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 per instance
```

**Initial Local Distribution:**
Each job type gets ~1-2 slots locally based on 0.33 ratio.

#### Test Case 1: All Flexible Job Types Complete (Baseline)

| What We Check        | Expected Result |
| -------------------- | --------------- |
| flexJobA completions | All complete    |
| flexJobB completions | All complete    |
| flexJobC completions | All complete    |
| Failed jobs          | No jobs fail    |

#### Test Case 2: Load Imbalance Handling

| What We Check                       | Expected Result |
| ----------------------------------- | --------------- |
| flexJobA completions (heavy load)   | All complete    |
| flexJobB completions (minimal load) | All complete    |
| flexJobC completions (minimal load) | All complete    |
| Failed jobs                         | No jobs fail    |

**Key Verification:** flexJobA can complete more jobs than its initial allocation because idle flexJobB and flexJobC donate capacity through local ratio adjustment.

---

### 6. Local Ratio Only (`localRatioOnly.test.ts`)

**Complexity:** Highest

**Purpose:** Check that the dynamic ratio is LOCAL only - not shared across instances via Redis.

**Config:** `flexibleRatio` (same as test 5)

#### Test Case 1: Independent Instance Ratio Management

**Scenario:**
1. Both instances start with equal pool allocations from Redis
2. Instance A receives heavy flexJobA load (triggers local ratio adjustment on A)
3. Instance B receives flexJobB jobs (uses B's unmodified local ratios)

| What We Check                     | Expected Result           |
| --------------------------------- | ------------------------- |
| Instance A heavy load completions | All complete              |
| Instance B jobs completions       | All complete              |
| Instance B queue duration         | B's jobs complete quickly |
| Failed jobs                       | No failures               |

**Key Verification:** Instance A's local ratio adjustment does NOT affect Instance B's pool allocation or local ratios. Each instance manages its own local ratio state.

#### Test Case 2: Pool Allocation Verification

| What We Check                     | Expected Result           |
| --------------------------------- | ------------------------- |
| Both instances have pool data     | `allocation.pools` exists |
| Same pool allocation from Redis   | `pools['flex-model'].totalSlots` equal on both |
| Pool not reduced by A's load      | B's pool slots unchanged  |

**Key Verification:** Redis provides the same per-model pools to all instances. Local ratio adjustments don't affect Redis allocations.

---

## Summary: What Each Test Proves

| Test                      | What It Checks                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot Calculation          | Pool-based slot calculations work correctly with different model and instance combinations                                                                              |
| Slots Evolve With Load    | Pool slots are properly released and reused over time                                                                                                                  |
| Fixed Ratio Isolation     | Fixed job types maintain protected capacity, cannot donate or receive from flexible types                                                                              |
| Flexible Ratio Adjustment | Local job type ratios adjust based on load (within each instance)                                                                                                      |
| Local Ratio Only          | Local ratio adjustments are NOT shared via Redis - each instance manages its own ratios                                                                                |
| Instance Scaling (Join)   | When instance B joins, pool slots are divided (A's allocation halves)                                                                                                  |
| Instance Scaling (Leave)  | When instance B leaves, pool slots are recombined (A's allocation doubles)                                                                                             |

---

## Data Structures

### AllocationInfo (from Redis)

```typescript
interface AllocationInfo {
  instanceCount: number;
  pools: {
    [modelId: string]: {
      totalSlots: number;
      tokensPerMinute: number;
      requestsPerMinute: number;
      tokensPerDay: number;
      requestsPerDay: number;
    };
  };
  dynamicLimits?: {
    [modelId: string]: {
      tokensPerMinute?: number;
      requestsPerMinute?: number;
      tokensPerDay?: number;
      requestsPerDay?: number;
    };
  };
}
```

### Local JobTypeManager State

Each instance maintains local state:

```typescript
interface JobTypeState {
  currentRatio: number;      // Can change based on local load
  initialRatio: number;      // From config
  flexible: boolean;         // Can donate/receive capacity
  inFlight: number;          // Current jobs running
  allocatedSlots: number;    // floor(poolSlots * currentRatio)
}
```

---

## Running the Tests

### Prerequisites

1. Start Redis:
   ```bash
   docker run -d -p 6379:6379 redis
   ```

2. Start the proxy:
   ```bash
   npm run e2e:proxy
   ```

3. Start server instances:
   ```bash
   npm run e2e:instance1  # Port 3001
   npm run e2e:instance2  # Port 3002
   ```

### Execute Tests

Run all distributed slots tests:
```bash
npm run test -- --testPathPattern="packages/e2e/testRunner/src/__tests__/(slotCalculation|fixedRatioIsolation|slotsEvolveWithLoad|instanceScaling|flexibleRatioAdjustment|localRatioOnly)"
```

### Recommended Execution Order

For debugging, run tests in order of complexity:

1. `slotCalculation` - Validates basic pool math
2. `fixedRatioIsolation` - Validates ratio protection
3. `slotsEvolveWithLoad` - Validates temporal behavior
4. `instanceScaling` - Validates instance dynamics
5. `flexibleRatioAdjustment` - Validates local ratio algorithm
6. `localRatioOnly` - Validates cross-instance isolation

---

## Troubleshooting

### "All models rejected by backend"

This error indicates the backend has no available pool slots. Check:
1. Instance count matches expected (pool slots are divided by instance count)
2. Model has capacity configured (TPM, RPM, or maxConcurrent)
3. Job type is configured in `resourceEstimationsPerJob`

### Jobs timing out

Increase `waitTimeoutMs` in the test configuration. Some tests with long-running jobs need 60-90 seconds.

### Inconsistent slot counts

Ensure Redis is clean between test runs. The first instance reset should use `cleanRedis: true`.

### Ratio not adjusting

The ratio adjustment algorithm only runs:
- Periodically (based on `adjustmentIntervalMs`, default 5000ms)
- After N releases (based on `releasesPerAdjustment`, default 10)

Ensure the test runs long enough for adjustments to trigger.
