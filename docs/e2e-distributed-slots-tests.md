# E2E Tests for Distributed Slots

This document describes the end-to-end test suites for verifying the multi-dimensional slot allocation system in the distributed rate limiter.

## Overview

The distributed slots feature implements per-job-type per-model slot calculation using the formula:

```
slots[jobType][model] = floor((modelCapacity / estimatedResourcePerJob) / instanceCount * jobTypeRatio)
```

These E2E tests verify that the implementation works correctly across multiple instances with various configurations.

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

**Purpose:** Check that the new available slot calculations work perfectly with different model, job type and instance combinations. This does not test load, does not queue any job, we only need to verify the initial slot allocation math works.

**Approach:**
1. Reset instances with a specific config preset
2. Query the allocation endpoint (`GET /api/debug/allocation`) from each instance
3. Compare `slotsByJobTypeAndModel` against mathematically calculated expected values
4. Repeat for multiple config presets covering all limit type combinations

**Test Configurations:**

We must test ALL possible combinations of rate limit types:

| Config Preset | Model Limits | Job Types | What It Tests |
|---------------|--------------|-----------|---------------|
| `slotCalc-tpm` | TPM only (100K) | 2 job types, different token estimates | TPM-based slot calculation |
| `slotCalc-rpm` | RPM only (500) | 2 job types, different request estimates | RPM-based slot calculation |
| `slotCalc-tpd` | TPD only (1M) | 2 job types | TPD-based slot calculation |
| `slotCalc-rpd` | RPD only (10K) | 2 job types | RPD-based slot calculation |
| `slotCalc-concurrent` | maxConcurrentRequests only (100) | 2 job types | Concurrency-based slot calculation |
| `slotCalc-memory` | TPM (high) + local memory constraint | 2 job types, different memory estimates | Memory is LOCAL: `finalSlots = min(distributedSlots, floor(memoryForJobType / estimatedMemoryKB))` |
| `slotCalc-tpm-rpm` | TPM (100K) + RPM (500) | 2 job types | Mixed limits (should use limiting factor) |
| `slotCalc-multi-model` | Model A: TPM, Model B: concurrent | 2 job types | Different limit types per model |
| `slotCalc-ratios` | TPM (100K) | 3 job types: ratio 0.5, 0.3, 0.2 | Different ratio combinations |
| `slotCalc-uneven-ratios` | TPM (100K) | 4 job types: ratio 0.7, 0.1, 0.1, 0.1 | Uneven ratio distribution |

**Slot Calculation Formula:**

```
For TPM-limited models:
  slots[jobType][model] = floor((TPM / estimatedTokens) / instanceCount * ratio)

For RPM-limited models:
  slots[jobType][model] = floor((RPM / estimatedRequests) / instanceCount * ratio)

For concurrent-limited models:
  slots[jobType][model] = floor(maxConcurrent / instanceCount * ratio)

For mixed limits:
  slots = min(tpm_slots, rpm_slots, concurrent_slots, ...)
```

#### Test Case 1: TPM-Only Model (`slotCalc-tpm`)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 5,000, ratio = 0.4
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-alpha.slots` | `floor((100K / 10K) / 2 * 0.6)` | 3 |
| `allocation.slotsByJobTypeAndModel.jobTypeB.model-alpha.slots` | `floor((100K / 5K) / 2 * 0.4)` | 4 |
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-alpha.tokensPerMinute` | `100K / 2` | 50,000 |

#### Test Case 2: RPM-Only Model (`slotCalc-rpm`)

**Config:**
```
model-beta: RPM = 500
jobTypeA: estimatedRequests = 1, ratio = 0.6
jobTypeB: estimatedRequests = 5, ratio = 0.4
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-beta.slots` | `floor((500 / 1) / 2 * 0.6)` | 150 |
| `allocation.slotsByJobTypeAndModel.jobTypeB.model-beta.slots` | `floor((500 / 5) / 2 * 0.4)` | 20 |
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-beta.requestsPerMinute` | `500 / 2` | 250 |

#### Test Case 3: Concurrent-Only Model (`slotCalc-concurrent`)

**Config:**
```
model-gamma: maxConcurrentRequests = 100
jobTypeA: ratio = 0.7
jobTypeB: ratio = 0.3
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-gamma.slots` | `floor(100 / 2 * 0.7)` | 35 |
| `allocation.slotsByJobTypeAndModel.jobTypeB.model-gamma.slots` | `floor(100 / 2 * 0.3)` | 15 |

#### Test Case 4: Mixed Limits - Limiting Factor (`slotCalc-tpm-rpm`)

**Config:**
```
model-delta: TPM = 100,000, RPM = 50
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1, ratio = 0.5
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| TPM-based slots | `floor((100K / 10K) / 2 * 0.5)` | 2 (from TPM) |
| RPM-based slots | `floor((50 / 1) / 2 * 0.5)` | 12 (from RPM) |
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-delta.slots` | `min(2, 12)` | 2 (TPM is limiting) |

#### Test Case 5: Multiple Models with Different Limit Types (`slotCalc-multi-model`)

**Config:**
```
model-tpm: TPM = 100,000
model-concurrent: maxConcurrentRequests = 50
jobTypeA: estimatedTokens = 10,000, ratio = 0.5
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-tpm.slots` | `floor((100K / 10K) / 2 * 0.5)` | 2 |
| `allocation.slotsByJobTypeAndModel.jobTypeA.model-concurrent.slots` | `floor(50 / 2 * 0.5)` | 12 |

#### Test Case 6: Various Ratio Combinations (`slotCalc-ratios`)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.5
jobTypeB: estimatedTokens = 10,000, ratio = 0.3
jobTypeC: estimatedTokens = 10,000, ratio = 0.2
```

| What We Check | What We Compare Against | Expected Result (2 instances) |
|---------------|------------------------|-------------------------------|
| jobTypeA slots | `floor((100K / 10K) / 2 * 0.5)` | 2 |
| jobTypeB slots | `floor((100K / 10K) / 2 * 0.3)` | 1 |
| jobTypeC slots | `floor((100K / 10K) / 2 * 0.2)` | 1 |
| Sum of ratios | 0.5 + 0.3 + 0.2 | 1.0 (must equal 1) |

#### Test Case 7: Instance Count Variations

Run each config with 1, 2, and 3 instances to verify instance division:

| Instance Count | Expected Slot Multiplier |
|----------------|-------------------------|
| 1 instance | Full capacity (slots × 1) |
| 2 instances | Half per instance (slots ÷ 2) |
| 3 instances | Third per instance (slots ÷ 3) |

**Key Verification:** The allocation endpoint returns mathematically correct slot values for ALL combinations of limit types, ratios, and instance counts.

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

**Calculated Expected Slots (2 instances):**
```
fixedJobType:     floor((100,000 / 10,000) / 2 * 0.4) = floor(5 * 0.4) = 2 per instance = 4 total
flexibleJobTypeA: floor((100,000 / 10,000) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total
flexibleJobTypeB: floor((100,000 / 10,000) / 2 * 0.3) = floor(5 * 0.3) = 1 per instance = 2 total
```

#### Test Case 1: Fixed Job Type Maintains Capacity

| What We Check                | What We Compare Against    | Expected Result                      |
| ---------------------------- | -------------------------- | ------------------------------------ |
| fixedJobType completions     | fixedJobType slots (4)     | All 4 fixedJobType jobs complete     |
| flexibleJobTypeA completions | flexibleJobTypeA slots (2) | All 2 flexibleJobTypeA jobs complete |
| flexibleJobTypeB completions | flexibleJobTypeB slots (2) | All 2 flexibleJobTypeB jobs complete |
| Failed jobs                  | Zero                       | No jobs fail                         |

#### Test Case 2: Fixed Ratio Not Affected by Flexible Overload

| What We Check                                             | What We Compare Against        | Expected Result                                      |
| --------------------------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| fixedJobType completions when flexible types overloaded   | fixedJobType capacity (4)      | All 4 fixedJobType jobs complete                     |
| fixedJobType queue duration                               | Threshold (2 seconds)          | fixedJobType jobs complete quickly (< 2s queue time) |
| flexibleJobTypeA completions                              | flexibleJobTypeA jobs sent (4) | All 4 eventually complete (some wait for capacity)   |
| flexibleJobTypeB completions                              | flexibleJobTypeB jobs sent (4) | All 4 eventually complete (some wait for capacity)   |
| Failed jobs                                               | Zero                           | No jobs fail                                         |

#### Test Case 3: Flexible Types Can Borrow From Each Other But Not From Fixed

| What We Check                                             | What We Compare Against        | Expected Result                                      |
| --------------------------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| flexibleJobTypeA overloaded, flexibleJobTypeB idle        | N/A                            | flexibleJobTypeA borrows from flexibleJobTypeB       |
| fixedJobType capacity during flexible rebalancing         | fixedJobType slots (4)         | fixedJobType still has exactly 4 slots               |
| fixedJobType completions                                  | fixedJobType jobs sent (4)     | All 4 complete quickly                               |
| Failed jobs                                               | Zero                           | No jobs fail                                         |

**Key Verification:** Even when both flexible types are overloaded and rebalancing ratios between themselves, fixedJobType maintains its protected 4 slots and cannot donate or receive capacity.

---

### 3. Slots Evolve With Load (`slotsEvolveWithLoad.test.ts`)

**Complexity:** Medium

**Purpose:** Check that the calculated slots evolve properly over time, when load increases and decreases.

**Config:** `slotCalculation` (same as test 1)

**Expected Slots:** jobTypeA = 6 total, jobTypeB = 8 total

#### Test Case 1: Sequential Acquire and Release

| What We Check                | What We Compare Against | Expected Result                                |
| ---------------------------- | ----------------------- | ---------------------------------------------- |
| Batch 1 (6 jobs) completions | jobTypeA capacity       | All 6 complete                                 |
| Batch 2 (6 jobs) completions | jobTypeA capacity       | All 6 complete (reusing freed slots)           |
| Total completions            | 12 jobs sent            | All 12 complete                                |
| Batch 1 queue duration       | Threshold (1 second)    | Batch 1 completes quickly (immediate capacity) |
| Failed jobs                  | Zero                    | No jobs fail                                   |

**Key Verification:** After Batch 1 completes and frees slots, Batch 2 can immediately use those freed slots.

#### Test Case 2: Concurrent Load with Slot Reuse

| What We Check              | What We Compare Against | Expected Result           |
| -------------------------- | ----------------------- | ------------------------- |
| Long jobs (3) completions  | Long jobs sent          | All 3 long jobs complete  |
| Short jobs (6) completions | Short jobs sent         | All 6 short jobs complete |
| Failed jobs                | Zero                    | No jobs fail              |

**Key Verification:** Short jobs wait while long jobs occupy slots, then acquire slots as long jobs complete.

#### Test Case 3: Multiple Job Types with Interleaved Load

| What We Check        | What We Compare Against       | Expected Result           |
| -------------------- | ----------------------------- | ------------------------- |
| jobTypeA completions | 6 initial + 3 additional = 9  | All 9 complete            |
| jobTypeB completions | 8 initial + 3 additional = 11 | All 11 complete           |
| Jobs per instance    | Total / 2                     | Roughly even distribution |
| Failed jobs          | Zero                          | No jobs fail              |

**Key Verification:** Both job types independently manage their slot pools through multiple acquire/release cycles.

---

### 4. Instance Scaling (`instanceScaling.test.ts`)

**Complexity:** Medium-High

**Purpose:** Check that if instance B joins AFTER instance A has joined, A slots halve. Check that if instance B disconnects, A slots double.

**Infrastructure Requirement:** The test runner must be able to **boot and kill server instances programmatically**, not just reset them. This requires:

1. `bootInstance(port, configPreset)` - Spawns a new server instance on the given port
2. `killInstance(port)` - Gracefully shuts down the instance on the given port
3. `getInstanceAllocation(port)` - Queries the allocation from a running instance

**Implementation Approach:**
```typescript
// Test runner spawns instances directly using the server module
import { createServer } from '@llm-rate-limiter/e2e-server-instance';

const instanceA = await createServer({ port: 3001, configPreset: 'instanceScaling' });
// ... verify A has 10 slots ...

const instanceB = await createServer({ port: 3002, configPreset: 'instanceScaling' });
// ... verify both have 5 slots ...

await instanceB.close();
// ... verify A now has 10 slots again ...
```

**Config:** `instanceScaling`
```
scale-model: 100K TPM
scaleJob: 10K tokens/job, ratio 1.0
```

**Calculated Expected Slots:**
```
1 instance: floor((100,000 / 10,000) / 1 * 1.0) = 10 slots
2 instances: floor((100,000 / 10,000) / 2 * 1.0) = 5 slots per instance
3 instances: floor((100,000 / 10,000) / 3 * 1.0) = 3 slots per instance
```

#### Test Case 1: Instance A Starts Alone

| What We Check | What We Compare Against | Expected Result |
|---------------|------------------------|-----------------|
| Boot instance A | N/A | Instance A starts successfully |
| Query A's allocation | Expected slots for 1 instance | `allocation.slotsByJobTypeAndModel.scaleJob['scale-model'].slots` = 10 |
| `allocation.instanceCount` | 1 | Exactly 1 instance registered |

**Key Verification:** A single instance gets the full capacity.

#### Test Case 2: Instance B Joins - A's Slots Halve

| What We Check | What We Compare Against | Expected Result |
|---------------|------------------------|-----------------|
| Boot instance B (while A running) | N/A | Instance B starts successfully |
| Wait for allocation propagation | N/A | Both instances receive updated allocation |
| Query A's allocation | Expected slots for 2 instances | `allocation.slotsByJobTypeAndModel.scaleJob['scale-model'].slots` = 5 |
| Query B's allocation | Expected slots for 2 instances | `allocation.slotsByJobTypeAndModel.scaleJob['scale-model'].slots` = 5 |
| `allocation.instanceCount` on both | 2 | Both see 2 instances registered |

**Key Verification:** When B joins, A's allocation is reduced from 10 to 5 slots. B also gets 5 slots. Total capacity preserved.

#### Test Case 3: Instance B Leaves - A's Slots Double

| What We Check | What We Compare Against | Expected Result |
|---------------|------------------------|-----------------|
| Kill instance B | N/A | Instance B shuts down gracefully |
| Wait for cleanup/reallocation | Instance timeout + propagation | A receives updated allocation |
| Query A's allocation | Expected slots for 1 instance | `allocation.slotsByJobTypeAndModel.scaleJob['scale-model'].slots` = 10 |
| `allocation.instanceCount` on A | 1 | Only 1 instance registered |

**Key Verification:** When B leaves, A's allocation increases from 5 back to 10 slots.

#### Test Case 4: Multiple Instance Joins

| What We Check | What We Compare Against | Expected Result |
|---------------|------------------------|-----------------|
| Boot A alone | N/A | A has 10 slots |
| Boot B | N/A | A and B each have 5 slots |
| Boot C | N/A | A, B, and C each have 3 slots |
| Kill C | N/A | A and B each have 5 slots |
| Kill B | N/A | A has 10 slots |

**Key Verification:** Slots redistribute correctly through multiple join/leave cycles.

---

### 5. Flexible Ratio Adjustment (`flexibleRatioAdjustment.test.ts`)

**Complexity:** High

**Purpose:** Check that if there are several job types and they have flexible behavior, their ratios are adjusted depending on the load.

**Config:** `flexibleRatio`
```
flex-model: 100K TPM
flexJobA: 10K tokens/job, ratio ~0.33, flexible: true
flexJobB: 10K tokens/job, ratio ~0.33, flexible: true
flexJobC: 10K tokens/job, ratio ~0.33, flexible: true
```

**Initial Expected Slots (2 instances):**
```
Each job type: floor((100,000 / 10,000) / 2 * 0.33) ≈ 1-2 per instance ≈ 3 total
```

#### Test Case 1: All Flexible Job Types Complete (Baseline)

| What We Check        | What We Compare Against | Expected Result |
| -------------------- | ----------------------- | --------------- |
| flexJobA completions | Jobs sent (3)           | All 3 complete  |
| flexJobB completions | Jobs sent (3)           | All 3 complete  |
| flexJobC completions | Jobs sent (3)           | All 3 complete  |
| Failed jobs          | Zero                    | No jobs fail    |

**Key Verification:** With equal load, all job types complete within their initial allocations.

#### Test Case 2: Load Imbalance Handling

| What We Check                       | What We Compare Against | Expected Result |
| ----------------------------------- | ----------------------- | --------------- |
| flexJobA completions (heavy load)   | Jobs sent (6)           | All 6 complete  |
| flexJobB completions (minimal load) | Jobs sent (1)           | 1 completes     |
| flexJobC completions (minimal load) | Jobs sent (1)           | 1 completes     |
| Failed jobs                         | Zero                    | No jobs fail    |

**Key Verification:** flexJobA can complete 6 jobs (more than initial ~3 slots) because idle flexJobB and flexJobC donate capacity through ratio adjustment.

#### Test Case 3: Ratio Adjustment Under Concurrent Load

| What We Check              | What We Compare Against | Expected Result |
| -------------------------- | ----------------------- | --------------- |
| Long flexJobB completions  | Jobs sent (3)           | All 3 complete  |
| Short flexJobA completions | Jobs sent (6)           | All 6 complete  |
| Total completions          | 9 jobs                  | All 9 complete  |
| Failed jobs                | Zero                    | No jobs fail    |

**Key Verification:** While flexJobB slots are occupied with long jobs, flexJobA gets extra capacity from idle flexJobC.

---

### 6. Local Ratio Only (`localRatioOnly.test.ts`)

**Complexity:** Highest

**Purpose:** Check that the dynamic ratio should NOT be shared across instances, it should be local only.

**Config:** `flexibleRatio` (same as test 5)

#### Test Case 1: Independent Instance Ratio Management

**Scenario:**
1. Both instances start with equal ratios (~0.33 each for flexJobA/B/C)
2. Instance A receives heavy flexJobA load (triggers ratio adjustment on A)
3. Instance B receives flexJobB jobs (should use B's unmodified ratios)

| What We Check                     | What We Compare Against | Expected Result           |
| --------------------------------- | ----------------------- | ------------------------- |
| Instance A heavy load completions | Jobs sent to A (6)      | All 6 complete            |
| Instance B jobs completions       | Jobs sent to B (3)      | All 3 complete            |
| Instance B queue duration         | Threshold (5 seconds)   | B's jobs complete quickly |
| Failed jobs (A)                   | Zero                    | No failures on A          |
| Failed jobs (B)                   | Zero                    | No failures on B          |

**Key Verification:** Instance A's ratio adjustment (giving more capacity to flexJobA) does NOT reduce Instance B's capacity for flexJobB.

#### Test Case 2: Mixed Load Across Instances

| What We Check     | What We Compare Against | Expected Result             |
| ----------------- | ----------------------- | --------------------------- |
| Total completions | 12 jobs (4 each type)   | All 12 complete             |
| Instance count    | 2                       | Both instances process jobs |
| Jobs per instance | > 0                     | Each instance has some jobs |
| Failed jobs       | Zero                    | No jobs fail                |

**Key Verification:** Both instances independently handle mixed load, each managing their own local ratios.

---

## Summary: What Each Test Proves

| Test                      | What It Checks                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot Calculation          | The new available slot calculations work perfectly with different model, job type and instance combinations                                                            |
| Slots Evolve With Load    | The calculated slots evolve properly over time, when load increases and decreases                                                                                      |
| Fixed Ratio Isolation     | If there are three job types, and one of them (fixedJobType) is not flexible, then filling the capacity of the flexible types should not alter the capacity of the fixed type |
| Flexible Ratio Adjustment | If there are several job types and they have flexible behavior, their ratios are adjusted depending on the load                                                        |
| Local Ratio Only          | The dynamic ratio should NOT be shared across instances, it should be local only                                                                                       |
| Instance Scaling (Join)   | If instance B joins AFTER instance A has joined, A slots halve                                                                                                         |
| Instance Scaling (Leave)  | If instance B disconnects, A slots double                                                                                                                              |

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

Run individual test suites:
```bash
npm run test -- --testPathPattern="slotCalculation"
npm run test -- --testPathPattern="instanceScaling"
```

### Recommended Execution Order

For debugging, run tests in order of complexity:

1. `slotCalculation` - Validates basic slot math
2. `fixedRatioIsolation` - Validates ratio protection
3. `slotsEvolveWithLoad` - Validates temporal behavior
4. `instanceScaling` - Validates instance dynamics
5. `flexibleRatioAdjustment` - Validates ratio algorithm
6. `localRatioOnly` - Validates cross-instance isolation

---

## Test Infrastructure

### Instance Lifecycle Management

For tests that need to verify instance join/leave behavior, the test runner must control instance lifecycle:

```typescript
import { createServer } from '@llm-rate-limiter/e2e-server-instance';

// Boot an instance
const instance = await createServer({
  primaryPort: 3001,
  redisUrl: 'redis://localhost:6379',
  configPreset: 'instanceScaling',
});

// Query allocation
const allocation = await fetchAllocation(instance.port);
console.log(allocation.slotsByJobTypeAndModel.scaleJob['scale-model'].slots); // e.g., 10

// Shut down instance
await instance.close();
```

**Key Functions:**
| Function | Purpose |
|----------|---------|
| `createServer(config)` | Boot a new instance with specified config |
| `instance.close()` | Gracefully shut down the instance |
| `fetchAllocation(port)` | Query `/api/debug/allocation` endpoint |
| `waitForAllocationUpdate(port, expected)` | Poll until allocation matches expected |

**Timing Considerations:**
- After instance joins: Wait for Redis pub/sub propagation (~500ms)
- After instance leaves: Wait for heartbeat timeout + cleanup interval (~15-20s default, configurable)

### Config Preset Selection

Tests specify which config to use via the `configPreset` option in `runSuite()`:

```typescript
data = await runSuite({
  suiteName: 'my-test',
  proxyUrl: PROXY_URL,
  instanceUrls: INSTANCE_URLS,
  jobs: myJobs,
  configPreset: 'slotCalculation',  // Use specific preset
});
```

The preset is passed to each instance via the reset endpoint:
```
POST /api/debug/reset
{ "cleanRedis": true, "configPreset": "slotCalculation" }
```

### Proxy Configuration

The test proxy (`packages/e2e/proxy`) distributes jobs across instances. Tests can control distribution:

```typescript
// Equal distribution
await fetch(`${PROXY_URL}/proxy/ratio`, {
  method: 'POST',
  body: JSON.stringify({ ratio: '1:1' }),
});

// All to instance A
await fetch(`${PROXY_URL}/proxy/ratio`, {
  method: 'POST',
  body: JSON.stringify({ ratio: '1:0' }),
});
```

### Test Data Collection

Each test suite generates a JSON file in `packages/e2e/testResults/src/data/` containing:
- Job events (queued, started, completed, failed)
- Snapshots of instance state at key moments
- Summary statistics (by instance, by model, by job type)

---

## Troubleshooting

### "All models rejected by backend"

This error indicates the backend has no available slots. Check:
1. Instance count matches expected (slots are divided by instance count)
2. Job type is configured in `resourceEstimationsPerJob`
3. Model has capacity configured (TPM, RPM, or maxConcurrent)

### Jobs timing out

Increase `waitTimeoutMs` in the test configuration. Some tests with long-running jobs need 60-90 seconds.

### Inconsistent slot counts

Ensure Redis is clean between test runs. The first instance reset should use `cleanRedis: true`.

### Ratio not adjusting

The ratio adjustment algorithm only runs:
- Periodically (based on `adjustmentIntervalMs`)
- After N releases (based on `releasesPerAdjustment`)

Ensure the test runs long enough for adjustments to trigger.
