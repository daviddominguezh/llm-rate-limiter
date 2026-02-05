# E2E Test Reference

This document provides detailed documentation for each e2e test file, including their purpose, configuration, and test cases.

## Test Summary

| Test File | Complexity | Purpose |
|-----------|------------|---------|
| `slotCalculation.test.ts` | Low | Verify pool-based slot calculations with different model/instance combinations |
| `exactCapacity.test.ts` | Low | Verify exact capacity jobs complete without failures |
| `capacityPlusOne.test.ts` | Low | Verify capacity+1 job waits for rate limit reset |
| `fixedRatioIsolation.test.ts` | Low | Verify fixed job types maintain protected capacity |
| `rateLimitQueuing.test.ts` | Low | Verify jobs queue properly when rate limited |
| `slotsEvolveWithLoad.test.ts` | Medium | Verify slots are released and reused over time |
| `instanceScaling.test.ts` | Medium-High | Verify pool slots redistribute on instance join/leave |
| `flexibleRatioAdjustment.test.ts` | High | Verify local ratios adjust based on load |
| `localRatioOnly.test.ts` | Highest | Verify ratio adjustments are local-only (not shared via Redis) |
| `modelEscalation.test.ts` | High | Verify job escalates to secondary model on timeout |
| `modelEscalationToThird.test.ts` | High | Verify job escalates through all three models |

---

## Slot Calculation Tests

**File:** `slotCalculation.test.ts`

**Complexity:** Low

**Purpose:** Verify that the pool-based slot calculations work correctly with different model and instance combinations. These tests do NOT queue any jobs - they only verify the initial pool allocation math by querying the allocation endpoint directly.

**Config Presets Used:** Various `slotCalc-*` presets

### Test Cases

#### TPM-Only Model (`slotCalc-tpm`)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 5,000, ratio = 0.4
```

**Note:** Pool slots use averaged estimates: `avgTokens = (10,000 + 5,000) / 2 = 7,500`

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-alpha'].totalSlots` | `floor((100K / 7,500) / 2)` | 6 |
| `allocation.pools['model-alpha'].tokensPerMinute` | `100K / 2` | 50,000 |

#### RPM-Only Model (`slotCalc-rpm`)

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

#### Concurrent-Only Model (`slotCalc-concurrent`)

**Config:**
```
model-gamma: maxConcurrentRequests = 100
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| `allocation.pools['model-gamma'].totalSlots` | `floor(100 / 2)` | 50 |

#### Mixed Limits - Limiting Factor (`slotCalc-tpm-rpm`)

**Config:**
```
model-delta: TPM = 100,000, RPM = 50
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
```

| What We Check | Formula | Expected (2 instances) |
|---------------|---------|------------------------|
| TPM-based slots | `floor((100K / 10K) / 2)` | 5 |
| RPM-based slots | `floor((50 / 1) / 2)` | 25 |
| `allocation.pools['model-delta'].totalSlots` | `min(5, 25)` | 5 (TPM is limiting) |

#### Instance Count Variations

| Instance Count | Pool Slot Division |
|----------------|-------------------|
| 1 instance | Full capacity |
| 2 instances | Half per instance |
| 3 instances | Third per instance |

#### Memory-Based Slot Calculation (`slotCalc-memory`)

**Config:**
```
test-model: TPM = 10,000,000 (very high)
heavyMemoryJob: estimatedMemoryKB = 10,240 (10MB)
lightMemoryJob: estimatedMemoryKB = 1,024 (1MB)
```

**Key Concept:** Memory is a LOCAL constraint. Redis calculates distributed slots based on TPM, but each instance limits final slots based on available memory.

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['test-model'].totalSlots` | Very high (5000+) |
| Memory stats present | `stats.memory.maxCapacityKB > 0` |

---

## Exact Capacity Test

**File:** `exactCapacity.test.ts`

**Complexity:** Low

**Purpose:** Send exactly the rate limiter capacity worth of jobs and verify all complete without failures.

**Config Preset:** `default`

**Capacity Calculation:**
- TPM limit: 500,000 tokens/minute
- Summary job: 10,000 tokens each
- Capacity: 500,000 / 10,000 = 50 jobs

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Job count | Exactly 50 jobs sent |
| Completions | All 50 jobs complete |
| Failures | No jobs fail |
| Distribution | Jobs split evenly across 2 instances (25 each) |
| Model used | All jobs use primary model (openai/gpt-5.2) |

---

## Capacity Plus One Test

**File:** `capacityPlusOne.test.ts`

**Complexity:** Low

**Purpose:** Send capacity + 1 jobs and verify the 51st job waits for the rate limit window to reset before completing.

**Config Preset:** `default`

**Configuration:**
- 2 instances share jobs evenly (proxy ratio 1:1)
- Each instance has 250,000 TPM = 25 jobs of 10,000 tokens
- Total capacity = 500,000 TPM = 50 jobs
- 51 jobs x 10,000 tokens = 510,000 tokens (exceeds capacity by 1 job)

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Job count | 51 jobs sent |
| Completions | All 51 jobs eventually complete |
| Failures | No jobs rejected |
| First 50 jobs | Complete quickly (< 500ms queue time) |
| 51st job | Waits for rate limit reset (> 1s queue time) |

---

## Fixed Ratio Isolation Test

**File:** `fixedRatioIsolation.test.ts`

**Complexity:** Low

**Purpose:** Verify that job types with `flexible: false` maintain their capacity even when other job types fill up or have high load.

**Config Preset:** `fixedRatio`

**Config:**
```
test-model: 100K TPM
fixedJobType: 10K tokens/job, ratio 0.4, flexible: false
flexibleJobTypeA: 10K tokens/job, ratio 0.3, flexible: true
flexibleJobTypeB: 10K tokens/job, ratio 0.3, flexible: true
```

**Pool Calculation (2 instances):**
```
pools['test-model'].totalSlots = floor((100,000 / 10,000) / 2) = 5 per instance

Local Distribution:
fixedJobType:     floor(5 * 0.4) = 2 slots (protected)
flexibleJobTypeA: floor(5 * 0.3) = 1 slot (can adjust)
flexibleJobTypeB: floor(5 * 0.3) = 1 slot (can adjust)
```

### Test Cases

#### Basic Capacity

| What We Check | Expected Result |
|---------------|-----------------|
| fixedJobType completions | All complete |
| flexibleJobTypeA completions | All complete |
| flexibleJobTypeB completions | All complete |
| Failed jobs | None |

#### Fixed Not Affected by Flexible Overload

| What We Check | Expected Result |
|---------------|-----------------|
| fixedJobType completions | All complete |
| fixedJobType queue duration | < 2s (completes quickly) |
| flexibleJobTypeA completions | All eventually complete |
| Failed jobs | None |

**Key Verification:** Even when flexible types are overloaded, fixedJobType maintains its protected slots.

---

## Rate Limit Queuing Test

**File:** `rateLimitQueuing.test.ts`

**Complexity:** Low

**Purpose:** Verify that jobs queue properly when rate limited and eventually complete.

**Config Preset:** `default`

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Failures | No jobs rejected immediately |
| Completions | All jobs eventually complete |
| Queue state | Jobs show as waiting in snapshots |
| Lifecycle | All jobs go through queued → started → completed |

---

## Slots Evolve With Load Test

**File:** `slotsEvolveWithLoad.test.ts`

**Complexity:** Medium

**Purpose:** Verify that slots are properly released and reused over time as load changes.

**Config Preset:** `slotCalculation`

### Test Cases

#### Sequential Acquire and Release

| What We Check | Expected Result |
|---------------|-----------------|
| Batch 1 completions | All complete |
| Batch 2 completions | All complete (reusing freed slots) |
| Batch 1 queue duration | Completes quickly |
| Failed jobs | None |

**Key Verification:** After Batch 1 completes and frees slots, Batch 2 can immediately use those freed slots.

#### Concurrent Load with Slot Reuse

| What We Check | Expected Result |
|---------------|-----------------|
| Long jobs completions | All complete |
| Short jobs completions | All complete |
| Failed jobs | None |

**Key Verification:** Short jobs wait while long jobs occupy slots, then acquire slots as long jobs complete.

---

## Instance Scaling Test

**File:** `instanceScaling.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify that pool slots redistribute correctly when instances join and leave.

**Config Preset:** `instanceScaling`

**Config:**
```
scale-model: 100K TPM
scaleJob: 10K tokens/job, ratio 1.0
```

**Pool Calculation:**
```
1 instance:  pools['scale-model'].totalSlots = 10 slots
2 instances: pools['scale-model'].totalSlots = 5 slots per instance
3 instances: pools['scale-model'].totalSlots = 3 slots per instance
```

### Test Cases

#### Instance A Starts Alone

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance A | Success |
| `allocation.pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` | 1 |

#### Instance B Joins - A's Pool Slots Halve

| What We Check | Expected Result |
|---------------|-----------------|
| Boot instance B | Success |
| A's `pools['scale-model'].totalSlots` | 5 |
| B's `pools['scale-model'].totalSlots` | 5 |
| `allocation.instanceCount` on both | 2 |

#### Instance B Leaves - A's Pool Slots Double

| What We Check | Expected Result |
|---------------|-----------------|
| Kill instance B | Success |
| A's `pools['scale-model'].totalSlots` | 10 |
| `allocation.instanceCount` on A | 1 |

**Key Verification:** Pool slots redistribute correctly through multiple join/leave cycles.

---

## Flexible Ratio Adjustment Test

**File:** `flexibleRatioAdjustment.test.ts`

**Complexity:** High

**Purpose:** Verify that flexible job types have their ratios adjusted locally based on load (donor/receiver algorithm).

**Config Preset:** `flexibleRatio`

**Config:**
```
flex-model: 100K TPM
flexJobA: 10K tokens/job, ratio ~0.33, flexible: true
flexJobB: 10K tokens/job, ratio ~0.33, flexible: true
flexJobC: 10K tokens/job, ratio ~0.33, flexible: true
```

### Test Cases

#### Baseline - All Job Types Complete

| What We Check | Expected Result |
|---------------|-----------------|
| flexJobA completions | All complete |
| flexJobB completions | All complete |
| flexJobC completions | All complete |
| Failed jobs | None |

#### Load Imbalance Handling

| What We Check | Expected Result |
|---------------|-----------------|
| flexJobA completions (heavy load) | All complete |
| flexJobB completions (minimal load) | All complete |
| flexJobC completions (minimal load) | All complete |
| Failed jobs | None |

**Key Verification:** flexJobA can complete more jobs than its initial allocation because idle flexJobB and flexJobC donate capacity through local ratio adjustment.

---

## Local Ratio Only Test

**File:** `localRatioOnly.test.ts`

**Complexity:** Highest

**Purpose:** Verify that dynamic ratio adjustments are LOCAL only - not shared across instances via Redis.

**Config Preset:** `flexibleRatio`

### Test Cases

#### Independent Instance Ratio Management

**Scenario:**
1. Both instances start with equal pool allocations from Redis
2. Instance A receives heavy flexJobA load (triggers local ratio adjustment on A)
3. Instance B receives flexJobB jobs (uses B's unmodified local ratios)

| What We Check | Expected Result |
|---------------|-----------------|
| Instance A heavy load completions | All complete |
| Instance B jobs completions | All complete |
| Instance B queue duration | B's jobs complete quickly |
| Failed jobs | None |

**Key Verification:** Instance A's local ratio adjustment does NOT affect Instance B's pool allocation or local ratios.

#### Pool Allocation Verification

| What We Check | Expected Result |
|---------------|-----------------|
| Both instances have pool data | `allocation.pools` exists |
| Same pool allocation from Redis | `pools['flex-model'].totalSlots` equal on both |
| Pool not reduced by A's load | B's pool slots unchanged |

---

## Model Escalation Test

**File:** `modelEscalation.test.ts`

**Complexity:** High

**Purpose:** Verify that when capacity is filled for 2 minutes, a job escalates to the next model after maxWaitMS timeout.

**Config Preset:** `default`

**Mechanism:**
- Jobs 1-50: Fill minute 0 capacity
- Jobs 51-100: Fill minute 1 capacity (queued until T=60)
- Job 101: Needs minute 2 capacity (T=120)
- Job 101's maxWaitMS (~65s) expires at T=65, before minute 2
- Job 101 escalates to xai/grok-4.1-fast

**Configuration:**
- openai/gpt-5.2: 500,000 TPM → 50 summary jobs per minute
- 100 capacity jobs + 1 test job = 101 total
- Job duration: 60 seconds

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Job count | 101 jobs sent |
| Completions | All 101 jobs complete |
| Failures | No jobs rejected |
| Capacity jobs model | All 100 run on openai/gpt-5.2 |
| Test job model | Escalates to xai/grok-4.1-fast |

---

## Model Escalation to Third Model Test

**File:** `modelEscalationToThird.test.ts`

**Complexity:** High

**Purpose:** Verify that when capacity is filled on BOTH primary and secondary models, jobs escalate to the third model.

**Config Preset:** `default`

**Mechanism:**
- Fill primary model (openai) with capacity jobs
- Fill secondary model (xai) with capacity jobs
- Send an additional job that can't fit on either
- The job times out on openai (~65s), then times out on xai (~65s)
- Job escalates to the third model (deepinfra)

**Capacity calculations:**
- openai/gpt-5.2: 500,000 TPM / 10,000 tokens = 50 jobs/min × 2 = 100 jobs
- xai/grok-4.1-fast: 4,000,000 TPM / 10,000 tokens = 400 jobs/min × 2 = 800 jobs

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Job count | 901 jobs sent |
| Completions | All 901 jobs complete |
| Failures | No jobs rejected |
| Models used | All three models (openai, xai, deepinfra) |
| Test job model | Escalates to deepinfra/gpt-oss-20b |
