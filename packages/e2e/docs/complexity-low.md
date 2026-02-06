# Low Complexity Tests

This document contains detailed documentation for tests with low complexity level.

---

## 1. Pool Slot Calculation

**File:** `slotCalculation.test.ts`

**Complexity:** Low

**Purpose:** Verify that the pool-based slot calculations work correctly with different model and instance combinations. These tests do NOT queue any jobs - they only verify the initial pool allocation math by querying the allocation endpoint directly.

**Config Presets Used:** Various `slotCalc-*` presets

### Test Cases

#### 1.1 Single Instance Gets Full Capacity

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
instanceCount = 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['model-alpha'].totalSlots` | 10 |
| `allocation.pools['model-alpha'].tokensPerMinute` | 100,000 |
| `allocation.instanceCount` | 1 |

#### 1.2 TPM-Only Model - Exact Slot Calculation (Averaged Estimates)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 5,000, ratio = 0.4
instanceCount = 2
```

**Note:** Pool slots use averaged estimates: `avgTokens = (10,000 + 5,000) / 2 = 7,500`

| What We Check | Formula | Expected |
|---------------|---------|----------|
| `allocation.pools['model-alpha'].totalSlots` | `floor((100K / 7,500) / 2)` | 6 |
| `allocation.pools['model-alpha'].tokensPerMinute` | `100K / 2` | 50,000 |

#### 1.3 RPM-Only Model - Exact Slot Calculation

**Config:**
```
model-beta: RPM = 500
jobTypeA: estimatedRequests = 1, ratio = 0.5
jobTypeB: estimatedRequests = 3, ratio = 0.5
instanceCount = 2
```

| What We Check | Formula | Expected |
|---------------|---------|----------|
| `allocation.pools['model-beta'].totalSlots` | `floor((500 / 2) / 2)` | 125 |
| `allocation.pools['model-beta'].requestsPerMinute` | `500 / 2` | 250 |

#### 1.4 Concurrent-Only Model - Exact Slot Calculation

**Config:**
```
model-gamma: maxConcurrentRequests = 100
instanceCount = 3
```

| What We Check | Formula | Expected |
|---------------|---------|----------|
| `allocation.pools['model-gamma'].totalSlots` | `floor(100 / 3)` | 33 |

#### 1.5 Mixed Limits - Limiting Factor Selection

**Config:**
```
model-delta: TPM = 100,000, RPM = 50, maxConcurrentRequests = 200
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
instanceCount = 2
```

| What We Check | Formula | Expected |
|---------------|---------|----------|
| TPM-based slots | `floor((100K / 10K) / 2)` | 5 |
| RPM-based slots | `floor((50 / 1) / 2)` | 25 |
| Concurrent-based slots | `floor(200 / 2)` | 100 |
| `allocation.pools['model-delta'].totalSlots` | `min(5, 25, 100)` | 5 (TPM is limiting) |

#### 1.6 Daily Limits - TPD/RPD Calculation

**Config:**
```
model-epsilon: TPD = 1,000,000, RPD = 10,000
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
instanceCount = 2
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['model-epsilon'].totalSlots` | 50 |
| `allocation.pools['model-epsilon'].tokensPerDay` | 500,000 |
| `allocation.pools['model-epsilon'].requestsPerDay` | 5,000 |

#### 1.7 Two Instances Split Capacity Exactly

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
instanceCount = 2
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['model-alpha'].totalSlots` | 5 |
| `allocation.pools['model-alpha'].tokensPerMinute` | 50,000 |

#### 1.8 Three Instances with Remainder

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
instanceCount = 3
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['model-alpha'].totalSlots` | 3 |
| `allocation.pools['model-alpha'].tokensPerMinute` | 33,333 |

#### 1.9 Zero Slots After Floor Division

**Config:**
```
model-alpha: TPM = 15,000
jobType: estimatedTokens = 10,000
instanceCount = 4
```

| What We Check | Expected Result |
|---------------|-----------------|
| Each instance pool slots | 0 |
| Jobs must wait or delegate | true |

#### 1.10 RPM as Limiting Factor Over TPM

**Config:**
```
model-alpha: TPM = 100,000, RPM = 6
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 1
instanceCount = 2
```

| What We Check | Expected Result |
|---------------|-----------------|
| `allocation.pools['model-alpha'].totalSlots` | 3 (RPM limiting) |

---

## 2. Local Ratio Distribution

**File:** `localRatioDistribution.test.ts`

**Complexity:** Low

**Purpose:** Verify that job type ratios distribute pool slots correctly using floor division.

### Test Cases

#### 2.1 Ratios Apply Exactly to Pool Slots

**Config:**
```
pools['model-alpha'].totalSlots = 10
jobTypeA: ratio = 0.6
jobTypeB: ratio = 0.4
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA slots | 6 |
| jobTypeB slots | 4 |

#### 2.2 Three Job Types Sum Correctly

**Config:**
```
pools['model-alpha'].totalSlots = 100
jobTypeA: ratio = 0.5
jobTypeB: ratio = 0.3
jobTypeC: ratio = 0.2
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA slots | 50 |
| jobTypeB slots | 30 |
| jobTypeC slots | 20 |
| Total | 100 |

#### 2.3 Floor Division Handles Remainders

**Config:**
```
pools['model-alpha'].totalSlots = 10
jobTypeA: ratio = 0.33
jobTypeB: ratio = 0.33
jobTypeC: ratio = 0.34
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA slots | 3 |
| jobTypeB slots | 3 |
| jobTypeC slots | 3 |

#### 2.4 Single Job Type Gets All Slots

**Config:**
```
pools['model-alpha'].totalSlots = 10
onlyJobType: ratio = 1.0
```

| What We Check | Expected Result |
|---------------|-----------------|
| onlyJobType slots | 10 |

#### 2.5 Load Calculated as InFlight / Allocated

**Config:**
```
jobTypeA: allocated = 10 slots, inFlight = 7
```

| What We Check | Expected Result |
|---------------|-----------------|
| Load percentage | 70% |

#### 2.6 Zero Allocated Handles Gracefully

**Config:**
```
jobTypeA: allocated = 0 slots
```

| What We Check | Expected Result |
|---------------|-----------------|
| No error thrown | true |
| Load treated as | 0% or N/A |

---

## 3. Memory Slot Calculation

**File:** `memorySlotCalculation.test.ts`

**Complexity:** Low

**Purpose:** Verify memory-based slot calculations work correctly.

### Test Cases

#### 3.1 Memory Slots Calculated Exactly

**Config:**
```
Instance memory: 100MB (102,400 KB)
jobTypeA: estimatedMemoryKB = 10,240 (10MB), ratio = 0.5
jobTypeB: estimatedMemoryKB = 5,120 (5MB), ratio = 0.5
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA memory slots | 5 |
| jobTypeB memory slots | 10 |

#### 3.2 Memory is Minimum Constraint

**Config:**
```
model-alpha: TPM = 1,000,000
estimatedTokens = 10,000
estimatedMemoryKB = 10,240 (10MB)
instanceCount = 2
Instance memory: 50MB
```

| What We Check | Expected Result |
|---------------|-----------------|
| Distributed (TPM) slots | 50 |
| Memory slots | 5 |
| Final slots | 5 (memory is limiting) |

#### 3.3 Distributed Wins When Lower

**Config:**
```
model-alpha: TPM = 10,000
estimatedTokens = 10,000
estimatedMemoryKB = 10,240 (10MB)
instanceCount = 2
Instance memory: 500MB
```

| What We Check | Expected Result |
|---------------|-----------------|
| Distributed (TPM) slots | 0 |
| Memory slots | 50 |
| Final slots | 0 (distributed is limiting) |

#### 3.4 Ratios Distribute Memory Correctly

**Config:**
```
Instance memory: 100MB
jobTypeA: estimatedMemoryKB = 10MB, ratio = 0.7
jobTypeB: estimatedMemoryKB = 10MB, ratio = 0.3
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA memory allocation | 70MB |
| jobTypeA slots | 7 |
| jobTypeB memory allocation | 30MB |
| jobTypeB slots | 3 |

#### 3.5 Zero Memory Estimate Disables Memory Limiting

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedMemoryKB = 0
Distributed slots = 10
```

| What We Check | Expected Result |
|---------------|-----------------|
| Final slots for jobTypeA | 10 (distributed) |
| Memory is not limiting factor | true |

#### 3.6 freeMemoryRatio Respected

**Config:**
```
model-alpha: TPM = 10,000,000
memory.freeMemoryRatio = 0.8
jobTypeA: estimatedMemoryKB = 10,240 (10MB)
Instance free memory: 100MB
```

| What We Check | Expected Result |
|---------------|-----------------|
| Usable memory (80%) | 80MB |
| Memory-based slots | 8 (not 10) |

---

## 4. Single Job Operations

**File:** `singleJobOperations.test.ts`

**Complexity:** Low

**Purpose:** Verify single job acquire/release operations work correctly.

### Test Cases

#### 4.1 Acquire Decrements Pool Slot

**Scenario:**
1. Instance has 5 pool slots
2. Submit 1 job
3. Verify in-flight = 1, available = 4

| What We Check | Before Job | After Acquire |
|---------------|------------|---------------|
| Available slots | 5 | 4 |
| In-flight | 0 | 1 |

#### 4.2 Release Increments Pool Slot

**Scenario:**
1. Instance has 4 available, 1 in-flight
2. Job completes
3. Verify available = 5, in-flight = 0

| What We Check | Before Release | After Release |
|---------------|----------------|---------------|
| Available slots | 4 | 5 |
| In-flight | 1 | 0 |

#### 4.3 Single Job Updates Global Counter Exactly

**Config:**
```
model-alpha: TPM = 100,000
Instance A and B running
```

**Scenario:**
1. Instance A completes job with actualTokens = 5,000, actualRequests = 1
2. Query global usage counter

| What We Check | Expected Result |
|---------------|-----------------|
| globalActualTokensThisMinute | 5,000 |
| globalActualRequestsThisMinute | 1 |

#### 4.4 Concurrent Slots Released Immediately

**Config:**
```
model-alpha: maxConcurrentRequests = 10
```

| What We Check | Before | After |
|---------------|--------|-------|
| In-flight concurrent | 1 | 0 |
| Available concurrent | 9 | 10 |

---

## 5. Exact Capacity Test

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

## 6. Capacity Plus One Test

**File:** `capacityPlusOne.test.ts`

**Complexity:** Low

**Purpose:** Validate window-based per-model-per-jobType rate limiting. Sends capacity + 1 "summary" jobs and verifies the overflow job waits for the next minute window, not just for a slot to free up.

**Config Preset:** `default`

**Key concept — rate slots vs concurrency slots:**

The per-model-per-jobType slot calculation (`calculateModelJobTypeSlots`) evaluates multiple dimensions (TPM, RPM, TPD, RPD, totalSlots) and picks the most restrictive. Each dimension has a window duration:
- TPM/RPM → 60s (minute window)
- TPD/RPD → 86,400s (day window)
- totalSlots → 0 (concurrency, no window)

When the winning dimension is rate-based (`windowMs > 0`), slots represent **jobs that can START per window**, not concurrent jobs. A finishing job does NOT free a rate slot — the tokens remain consumed for the entire window. New capacity only appears when the window resets.

**Capacity calculation (per-model-per-jobType):**

```
Model: openai/gpt-5.2 (TPM=500,000, RPM=500)
Job type: summary (estimatedTokens=10,000, estimatedRequests=1, ratio=0.3)
Instances: 2

Per-instance pool from Redis:
  tokensPerMinute = 500,000 / 2 = 250,000
  requestsPerMinute = 500 / 2 = 250

Slot candidates per dimension:
  TPM: floor(250,000 × 0.3 / 10,000) =  7 slots  (windowMs = 60,000)
  RPM: floor(250 × 0.3 / 1)          = 75 slots  (windowMs = 60,000)

Winner: TPM with 7 rate slots per minute (most restrictive)
Total across 2 instances: 14 rate slots per minute window
```

**Configuration:**
- 2 instances share jobs evenly (proxy ratio 1:1)
- 15 "summary" jobs sent (14 capacity + 1 overflow)
- Each job takes 100ms to process

### Test Cases

| What We Check | Expected Result |
|---------------|-----------------|
| Job count | 15 jobs sent |
| Completions | All 15 jobs complete |
| Failures | No jobs rejected |
| First 14 jobs | Start immediately (< 500ms queue time) |
| 15th job timing | Sent in minute N, started in minute N+1 |
| 15th job model | Ran on openai (not escalated) |
| Full lifecycle | All jobs go through queued → started → completed |

---

## 7. Fixed Ratio Isolation Test

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

## 8. Rate Limit Queuing Test

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
