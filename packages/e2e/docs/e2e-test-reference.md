# E2E Test Reference

This document provides detailed documentation for each e2e test file, including their purpose, configuration, and test cases.

## Test Summary

| Test File | Complexity | Purpose |
|-----------|------------|---------|
| `infrastructureBoot.test.ts` | Lowest | Verifies the infra is set so tests can run |
| `slotCalculation.test.ts` | Low | Verify pool-based slot calculations with different model/instance combinations |
| `localRatioDistribution.test.ts` | Low | Verify ratios distribute pool slots correctly using floor division |
| `memorySlotCalculation.test.ts` | Low | Verify memory-based slot calculations |
| `singleJobOperations.test.ts` | Low | Verify acquire/release slot operations for single jobs |
| `exactCapacity.test.ts` | Low | Verify exact capacity jobs complete without failures |
| `capacityPlusOne.test.ts` | Low | Verify capacity+1 job waits for rate limit reset |
| `fixedRatioIsolation.test.ts` | Low | Verify fixed job types maintain protected capacity |
| `rateLimitQueuing.test.ts` | Low | Verify jobs queue properly when rate limited |
| `actualUsageRefunds.test.ts` | Medium | Verify unused capacity is refunded correctly |
| `actualUsageOverages.test.ts` | Medium | Verify overages are added to usage counters |
| `tokenTypeBreakdown.test.ts` | Medium | Verify input/output/cached tokens are totaled correctly |
| `errorHandling.test.ts` | Medium | Verify error scenarios handle capacity correctly |
| `queueBehavior.test.ts` | Medium | Verify queue operations (FIFO, waking, concurrency) |
| `maxWaitMsBehavior.test.ts` | Medium | Verify maxWaitMS timeout and delegation behavior |
| `slotsEvolveWithLoad.test.ts` | Medium | Verify slots are released and reused over time |
| `fixedRatioProtection.test.ts` | Medium | Verify fixed job types are protected from ratio adjustments |
| `flexibleRatioAdjustment.test.ts` | Medium-High | Verify local ratios adjust based on load |
| `memoryConstraintEnforcement.test.ts` | Medium-High | Verify memory constraints block/release jobs correctly |
| `modelEscalationBasic.test.ts` | Medium-High | Verify basic model escalation behavior |
| `modelEscalationRateLimits.test.ts` | Medium-High | Verify escalation triggered by different rate limit types |
| `modelEscalationTimeout.test.ts` | Medium-High | Verify escalation after maxWaitMS timeout |
| `modelEscalationCapacityTracking.test.ts` | Medium-High | Verify capacity tracking during escalation |
| `instanceScaling.test.ts` | High | Verify pool slots redistribute on instance join/leave |
| `twoLayerAcquireRelease.test.ts` | High | Verify local-then-Redis acquire pattern |
| `multiModelIndependence.test.ts` | High | Verify models have independent pools |
| `multiResourceAdjustment.test.ts` | High | Verify TPM/RPM/TPD/RPD adjust together |
| `timeWindowHandling.test.ts` | High | Verify time-window-aware refund/overage behavior |
| `distributedInstanceScaling.test.ts` | High | Verify instance join/leave in distributed mode |
| `distributedGlobalUsageTracking.test.ts` | High | Verify global usage accumulates across instances |
| `distributedCrossInstancePropagation.test.ts` | High | Verify overages/refunds propagate to all instances |
| `distributedPubSub.test.ts` | High | Verify pub/sub allocation broadcasts |
| `distributedDynamicLimits.test.ts` | High | Verify dynamic limits update local rate limiters |
| `distributedTimeWindows.test.ts` | High | Verify time window resets in distributed mode |
| `distributedRequestCountTracking.test.ts` | High | Verify RPM/RPD tracked separately from TPM/TPD |
| `distributedMultiModelTracking.test.ts` | High | Verify per-model tracking in distributed mode |
| `localRatioOnly.test.ts` | Highest | Verify ratio adjustments are local-only (not shared via Redis) |
| `distributedRatioManagement.test.ts` | Highest | Verify ratio changes not shared via Redis |
| `distributedMemoryIndependence.test.ts` | Highest | Verify memory constraints are local-only |
| `distributedAcquireRelease.test.ts` | Highest | Verify Redis coordination for acquire/release |
| `distributedWaitQueue.test.ts` | Highest | Verify per-instance wait queues in distributed mode |
| `distributedEscalation.test.ts` | Highest | Verify escalation works across instances |
| `distributedGracefulDegradation.test.ts` | Highest | Verify operation continues when Redis unavailable |
| `redisKeyManagement.test.ts` | Highest | Verify Redis key TTL cleanup |
| `zeroActualUsage.test.ts` | Highest | Verify full refund for zero actual usage |
| `jobPriority.test.ts` | Highest | Verify different job types have different wait behaviors |
| `highConcurrency.test.ts` | Highest | Verify global limits under high concurrency |
| `edgeCases.test.ts` | Highest | Verify edge cases (large instance count, floor rounding, etc.) |
| `modelEscalation.test.ts` | High | Verify job escalates to secondary model on timeout |
| `modelEscalationToThird.test.ts` | High | Verify job escalates through all three models |

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

---

## 9. Actual Usage Refunds

**File:** `actualUsageRefunds.test.ts`

**Complexity:** Medium

**Purpose:** Verify unused capacity is refunded correctly when job completes in same window.

### Test Cases

#### 9.1 Same-Window Refund - Exact Amount

**Config:**
```
model-alpha: TPM = 100,000
job estimated: 10,000 tokens
job actual: 6,000 tokens
```

**Scenario:**
1. Job starts at T=10:00:30, reserves 10,000 tokens
2. Job completes at T=10:00:45, used 6,000 tokens
3. 4,000 tokens should be refunded

| What We Check | Expected Result |
|---------------|-----------------|
| Tokens reserved before | 10,000 |
| Tokens after refund | 6,000 |
| Available capacity increase | +4,000 |

#### 9.2 Full Refund - Zero Actual Usage

**Scenario:**
1. Job reserves 10,000 tokens
2. Job completes with actual = 0 (fully cached)
3. All 10,000 tokens refunded

| What We Check | Expected Result |
|---------------|-----------------|
| Tokens refunded | 10,000 |

#### 9.3 Request Count Refund

**Scenario:**
1. Job reserves estimatedRequests = 5
2. Job completes with actualRequests = 2
3. 3 requests should be refunded

| What We Check | Expected Result |
|---------------|-----------------|
| Requests refunded | 3 |

#### 9.4 Cross-Window - No Refund

**Scenario:**
1. Job starts at T=10:00:55, reserves 10,000 tokens
2. Job completes at T=10:01:10, used 6,000 tokens
3. NO refund should occur (window 10:00 already closed)

| What We Check | Expected Result |
|---------------|-----------------|
| Minute 10:00 counter | 10,000 (unchanged) |
| Minute 10:01 counter | 0 |

#### 9.5 Multiple Refunds Accumulate

**Scenario:**
1. Job 1: refund 4000 tokens
2. Job 2: refund 3000 tokens
3. Job 3: refund 2000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| Total capacity restored | 9,000 |

#### 9.6 Refund Enables Previously Blocked Job

**Config:**
```
TPM = 100,000
estimatedTokens = 10,000
Available before: 9,000 (can't start new job)
```

**Scenario:**
1. Job A waiting (needs 10,000, only 9,000 available)
2. Job B completes with 2,000 token refund
3. Available now 11,000
4. Job A should start

| What We Check | Expected Result |
|---------------|-----------------|
| Job A status before refund | Queued |
| Job A status after refund | Running |

---

## 10. Actual Usage Overages

**File:** `actualUsageOverages.test.ts`

**Complexity:** Medium

**Purpose:** Verify overages are added to usage counters for accurate tracking.

### Test Cases

#### 10.1 Overage Added to Counter

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
```

**Scenario:**
1. Job reserves 10,000 tokens
2. Job completes with actual = 15,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| Counter value | 15,000 |
| Overage amount | 5,000 |

#### 10.2 onOverage Callback Invoked with Correct Details

**Scenario:**
1. Job estimated: 10,000 tokens
2. Job actual: 15,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| callback.overage | 5,000 |
| callback.estimated | 10,000 |
| callback.actual | 15,000 |
| callback.resourceType | 'tokens' |

#### 10.3 Overage Reduces Available Capacity

**Config:**
```
model-alpha: TPM = 100,000
Available before job: 50,000
```

**Scenario:**
1. Job reserves 10,000, uses 15,000

| What We Check | Before | After |
|---------------|--------|-------|
| Available capacity | 50,000 | 35,000 |

#### 10.4 Cross-Window Overage Still Counted

**Scenario:**
1. Job starts minute 10, reserves 10,000
2. Job completes minute 11, used 15,000

| What We Check | Expected Result |
|---------------|-----------------|
| Minute 11 counter | 15,000 |

#### 10.5 Request Overage Tracked Separately

**Scenario:**
1. Job estimated: tokens=10000, requests=1
2. Job actual: tokens=8000, requests=3

| What We Check | Expected Result |
|---------------|-----------------|
| Tokens adjustment | Refund 2,000 |
| Requests adjustment | Overage 2 |

---

## 11. Token Type Breakdown

**File:** `tokenTypeBreakdown.test.ts`

**Complexity:** Medium

**Purpose:** Verify input/output/cached tokens are totaled correctly.

### Test Cases

#### 11.1 Input + Output + Cached Totaled Correctly

**Scenario:**
1. Job returns: inputTokens=3000, outputTokens=2000, cachedTokens=1000

| What We Check | Expected Result |
|---------------|-----------------|
| Total tokens counted | 6,000 |

#### 11.2 Cached Tokens Counted

**Scenario:**
1. Job returns: inputTokens=0, outputTokens=0, cachedTokens=5000

| What We Check | Expected Result |
|---------------|-----------------|
| Actual tokens | 5,000 |

#### 11.3 Cached Tokens Included in Overage Calculation

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
```

**Steps:**
1. Send 1 job that returns: inputTokens=3000, outputTokens=2000, cachedTokens=7000, requestCount=1
2. Total actual = 12,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| TPM counter | 12,000 tokens |
| Overage amount | 2,000 tokens |
| onOverage called | true |

---

## 12. Error Handling

**File:** `errorHandling.test.ts`

**Complexity:** Medium

**Purpose:** Verify error scenarios handle capacity correctly.

### Test Cases

#### 12.1 Error Without Reject - No Time-Window Release

**Config:**
```
model-alpha: TPM = 20,000
jobType: estimatedTokens = 10,000
instances: 1
```

**Scenario:**
1. Job reserves 10,000 tokens
2. Job throws error (no reject() call)

| What We Check | Expected Result |
|---------------|-----------------|
| TPM counter | 10,000 (still reserved) |
| Capacity released | 0 |

#### 12.2 Error Without Reject - Concurrency Released

**Config:**
```
model-alpha: maxConcurrentRequests = 5
```

**Scenario:**
1. Job acquires concurrent slot
2. Job throws error (no reject() call)

| What We Check | Before Error | After Error |
|---------------|--------------|-------------|
| Concurrent in-flight | 1 | 0 |

#### 12.3 Error Without Reject - Memory Released

**Config:**
```
model-alpha: TPM = 10,000,000
jobTypeA: estimatedMemoryKB = 50,000 (50MB)
instances: 1
memory limit: 100MB (2 slots max)
```

**Scenario:**
1. Job reserves memory slot
2. Job throws error (no reject() call)

| What We Check | Before Error | After Error |
|---------------|--------------|-------------|
| Memory in-flight | 1 | 0 |

#### 12.4 Reject With Full Usage - Adjusts Like Success

**Scenario:**
1. Job reserves 10,000 tokens
2. Job calls reject({ requestCount: 1, inputTokens: 4000, outputTokens: 2000, cachedTokens: 0 })

| What We Check | Expected Result |
|---------------|-----------------|
| Counter value | 6,000 |
| Refund amount | 4,000 |

#### 12.5 Reject With Zero Usage - Full Refund

**Scenario:**
1. Job reserves 10,000 tokens
2. Job calls reject({ requestCount: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 })

| What We Check | Expected Result |
|---------------|-----------------|
| Refund amount | 10,000 |
| Counter value | 0 |

#### 12.6 Reject With Overage Usage

**Scenario:**
1. Job reserves 10,000 tokens
2. Job calls reject({ requestCount: 2, inputTokens: 10000, outputTokens: 8000, cachedTokens: 0 })

| What We Check | Expected Result |
|---------------|-----------------|
| Counter value | 18,000 |
| Overage amount | 8,000 |
| onOverage called | true |

---

## 13. Queue Behavior

**File:** `queueBehavior.test.ts`

**Complexity:** Medium

**Purpose:** Verify queue operations work correctly.

### Test Cases

#### 13.1 Job Queued When Capacity Unavailable

**Config:**
```
maxWaitMS: { 'model-alpha': 60000 }
model-alpha: capacity = 5 jobs
```

**Scenario:**
1. Submit 5 jobs (fill capacity)
2. Submit job 6

| What We Check | Expected Result |
|---------------|-----------------|
| Job 6 status | Queued |
| Queue length | 1 |

#### 13.2 Queued Job Starts When Capacity Available

**Config:**
```
Job duration: 100ms
maxWaitMS: 60000
```

**Scenario:**
1. 5 jobs running (capacity full)
2. Job 6 queued
3. Job 1 completes

| What We Check | Expected Result |
|---------------|-----------------|
| Job 6 start delay after Job 1 complete | < 100ms |

#### 13.3 FIFO Queue Order Preserved

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 60000 }
```

**Steps:**
1. Send 10 jobs (2-second duration) to fill capacity
2. Wait 200ms
3. Send jobs 11, 12, 13 in sequence with 50ms gaps

| What We Check | Expected Result |
|---------------|-----------------|
| Job 11 completes before job 12 | true |
| Job 12 completes before job 13 | true |
| Completion order | 1, 2, 3, ..., 11, 12, 13 |

#### 13.4 Concurrent Acquires Respect Pool Limit

**Config:**
```
pools['model-alpha'].totalSlots = 5
jobDuration = 60000ms (long running)
```

**Scenario:**
1. Submit 10 jobs simultaneously

| What We Check | Expected Result |
|---------------|-----------------|
| Running jobs | 5 |
| Queued jobs | 5 |
| Pool slot overage | 0 |

#### 13.5 Job Completion Wakes Queue

**Scenario:**
1. Capacity = 1
2. Job A running, Job B queued
3. Job A completes

| What We Check | Expected Result |
|---------------|-----------------|
| Job B wake delay | < 50ms |

---

## 14. maxWaitMS Behavior

**File:** `maxWaitMsBehavior.test.ts`

**Complexity:** Medium

**Purpose:** Verify maxWaitMS timeout and delegation behavior.

### Test Cases

#### 14.1 Default Calculated from Time to Next Minute + 5s

**Scenario:**
1. Job submitted at T=10:00:30
2. Default maxWaitMS should be (60 - 30 + 5) * 1000 = 35,000ms

| Job Submit Time (seconds) | Expected maxWaitMS |
|---------------------------|-------------------|
| :00 | 65,000ms |
| :30 | 35,000ms |
| :55 | 10,000ms |
| :59 | 6,000ms |

#### 14.2 maxWaitMS=0 Causes Immediate Delegation

**Config:**
```
model-primary: TPM = 10,000
model-secondary: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-primary': 0 }
escalationOrder: ['model-primary', 'model-secondary']
instances: 1
```

**Steps:**
1. Send 1 job to fill model-primary capacity
2. Immediately send job-2 with maxWaitMS=0 for model-primary

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 completes on | model-primary |
| job-2 completes on | model-secondary (delegated) |
| job-2 queue duration | < 100ms |

#### 14.3 maxWaitMS=0 Causes Immediate Rejection When No Fallback

**Config:**
```
model-only: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-only': 0 }
escalationOrder: ['model-only']
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 completes successfully | true |
| job-2 fails | true |
| job-2 error message | Contains "no capacity available" |
| job-2 failure time | < 100ms |

#### 14.4 Explicit maxWaitMS Value Respected

**Config:**
```
model-alpha: TPM = 10,000
model-beta: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 5000 }
escalationOrder: ['model-alpha', 'model-beta']
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 completes on | model-alpha |
| job-2 completes on | model-beta (delegated) |
| Delegation time | >= 4900ms AND <= 5500ms |

#### 14.5 maxWaitMS Per-Model Configuration

**Config:**
```
model-fast: TPM = 10,000
model-slow: TPM = 10,000
model-fallback: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-fast': 1000, 'model-slow': 10000 }
escalationOrder: ['model-fast', 'model-slow', 'model-fallback']
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| job-3 waits on model-fast | ~1000ms |
| job-3 waits on model-slow | ~10000ms |
| job-3 completes on | model-fallback |
| Total wait time | >= 10500ms AND <= 12000ms |

#### 14.6 Timeout Removes Job From Queue Correctly

**Config:**
```
model-alpha: TPM = 10,000
model-beta: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 2000 }
escalationOrder: ['model-alpha', 'model-beta']
instances: 1
job duration: 5000ms
```

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 completes on | model-alpha |
| job-2 times out after | 2000ms |
| job-2 delegates to | model-beta |
| No jobs are lost | true |

#### 14.7 Job Completes During Wait (Capacity Released)

**Config:**
```
model-alpha: TPM = 10,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 30000 }
instances: 1
job duration: 2000ms
```

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 completes in | ~2000ms |
| job-2 starts after | job-1 completes |
| job-2 queue duration | >= 1900ms AND <= 2500ms |
| Both jobs complete on | model-alpha |

#### 14.8 Multiple Jobs Timeout Simultaneously

**Config:**
```
maxWaitMS: { 'model-alpha': 5000 }
Capacity = 0
```

**Scenario:**
1. Submit 10 jobs at same time
2. All timeout at 5s

| What We Check | Expected Result |
|---------------|-----------------|
| Jobs delegated | 10 |
| Timing | ~5,000ms |

---

## 15. Slots Evolve With Load Test

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

## 16. Fixed Ratio Protection

**File:** `fixedRatioProtection.test.ts`

**Complexity:** Medium

**Purpose:** Verify fixed job types are protected from ratio adjustments.

### Test Cases

#### 16.1 Fixed Ratio Never Changes

**Config:**
```
pools['model-alpha'].totalSlots = 10
fixedJobType: ratio = 0.4, flexible = false
flexibleJobType: ratio = 0.6, flexible = true
```

**Scenario:**
1. Initial: fixed = 4 slots, flexible = 6 slots
2. Send 100 jobs to flexibleJobType (high load)
3. Send 0 jobs to fixedJobType
4. After ratio adjustment runs

| What We Check | Initial | Final | Changed |
|---------------|---------|-------|---------|
| fixedJobType slots | 4 | 4 | No |
| flexibleJobType slots | 6 | 6 | No (can't take from fixed) |

#### 16.2 Fixed Ratio Protected Under Heavy Flexible Load

**Config:**
```
pools['model-alpha'].totalSlots = 10
fixedJobType: ratio = 0.3, flexible = false
flexJobA: ratio = 0.35, flexible = true
flexJobB: ratio = 0.35, flexible = true
```

**Scenario:**
1. Submit 50 flexJobA jobs (heavy load)
2. Fixed job type should still have 3 slots available
3. Submit 1 fixedJobType job

| What We Check | Expected Result |
|---------------|-----------------|
| fixedJobType slots reserved | 3 |
| fixedJobType job queue time | < 100ms |

#### 16.3 Multiple Fixed Types All Protected

**Config:**
```
pools['model-alpha'].totalSlots = 10
fixedA: ratio = 0.3, flexible = false
fixedB: ratio = 0.3, flexible = false
flexibleC: ratio = 0.4, flexible = true
```

| What We Check | Slots | Protected |
|---------------|-------|-----------|
| fixedA | 3 | Yes |
| fixedB | 3 | Yes |
| flexibleC | 4 | No |

---

## 17. Flexible Ratio Adjustment Test

**File:** `flexibleRatioAdjustment.test.ts`

**Complexity:** Medium-High

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

#### 17.1 High Load Receiver Gets More Slots

**Config:**
```
pools['model-alpha'].totalSlots = 100
flexJobA: ratio = 0.33, flexible: true
flexJobB: ratio = 0.33, flexible: true
flexJobC: ratio = 0.34, flexible: true
highLoadThreshold = 0.7 (70%)
lowLoadThreshold = 0.3 (30%)
```

**Scenario:**
1. flexJobA: 32 jobs in-flight out of 33 slots (97% load) - RECEIVER
2. flexJobB: 5 jobs in-flight out of 33 slots (15% load) - DONOR
3. flexJobC: 5 jobs in-flight out of 34 slots (15% load) - DONOR
4. Adjustment runs

| What We Check | Initial | Direction | Final Direction |
|---------------|---------|-----------|-----------------|
| flexJobA | 33 | Receiver | > 33 |
| flexJobB | 33 | Donor | < 33 |
| flexJobC | 34 | Donor | < 34 |

#### 17.2 Adjustment Respects maxAdjustment

**Config:**
```
model-alpha: TPM = 100,000
flexJobA: ratio = 0.5, flexible = true
flexJobB: ratio = 0.5, flexible = true
maxAdjustment: 0.2 (20% max change)
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| flexJobA ratio change | <= 0.2 |
| flexJobA new ratio | <= 0.7 (0.5 + 0.2) |
| flexJobB new ratio | >= 0.3 (0.5 - 0.2) |

#### 17.3 minRatio Prevents Complete Starvation

**Config:**
```
model-alpha: TPM = 100,000
flexJobA: ratio = 0.5, flexible = true
flexJobB: ratio = 0.5, flexible = true
minRatio: 0.01
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| flexJobB ratio | >= 0.01 (never below minRatio) |
| flexJobB always has at least | floor(pool * 0.01) slot access |

#### 17.4 Ratios Always Sum to ~1.0

**Scenario:**
1. Multiple adjustment cycles
2. Sum of all ratios should remain approximately 1.0

| What We Check | Expected | Tolerance |
|---------------|----------|-----------|
| Sum of ratios | 1.0 | 0.001 |

#### 17.5 Only High Load Types Are Receivers

**Config:**
```
highLoadThreshold = 0.7
flexJobA: 60% load - NOT receiver
flexJobB: 80% load - RECEIVER
```

| What We Check | Load | Is Receiver |
|---------------|------|-------------|
| flexJobA | 60% | No |
| flexJobB | 80% | Yes |

#### 17.6 Only Low Load Types Are Donors

**Config:**
```
lowLoadThreshold = 0.3
flexJobA: 20% load - DONOR
flexJobB: 40% load - NOT donor
```

| What We Check | Load | Is Donor |
|---------------|------|----------|
| flexJobA | 20% | Yes |
| flexJobB | 40% | No |

#### 17.7 Middle Load Types Neither Donate Nor Receive

**Config:**
```
lowLoadThreshold = 0.3
highLoadThreshold = 0.7
flexJobA: 50% load
```

| What We Check | Load | Action |
|---------------|------|--------|
| flexJobA | 50% | None (unchanged) |

#### 17.8 All Job Types High Load - No Adjustment

**Scenario:**
1. All flexible types at 90% load
2. No donors available

| What We Check | Expected Result |
|---------------|-----------------|
| Ratios changed | No |

#### 17.9 All Job Types Low Load - No Adjustment

**Scenario:**
1. All flexible types at 10% load
2. No receivers available

| What We Check | Expected Result |
|---------------|-----------------|
| Ratios changed | No |

---

## 18. Memory Constraint Enforcement

**File:** `memoryConstraintEnforcement.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify memory constraints block/release jobs correctly.

### Test Cases

#### 18.1 Jobs Blocked When Memory Exhausted

**Config:**
```
Instance memory: 50MB
estimatedMemoryKB = 10MB
Memory slots = 5
```

**Scenario:**
1. Submit 5 jobs (all memory slots used)
2. Submit 6th job

| What We Check | Expected Result |
|---------------|-----------------|
| Running jobs | 5 |
| Queued jobs | 1 |

#### 18.2 Memory Released on Job Completion

**Config:**
```
Memory slots = 5
All 5 in use
Job duration: 100ms
```

**Scenario:**
1. 5 jobs running, 1 queued
2. Job 1 completes

| What We Check | Before | After |
|---------------|--------|-------|
| Running | 5 | 5 |
| Queued | 1 | 0 |
| Queued job start delay | - | < 100ms |

#### 18.3 Memory and Ratio Interaction After Adjustment

**Config:**
```
model-alpha: TPM = 10,000,000
jobTypeA: estimatedMemoryKB = 10,240, ratio = 0.5, flexible = true
jobTypeB: estimatedMemoryKB = 10,240, ratio = 0.5, flexible = true
Instance memory: 100MB
```

**Scenario:**
1. Initial: 5 slots each job type (50MB / 10MB)
2. Trigger ratio adjustment (jobTypeA → 0.7, jobTypeB → 0.3)

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA memory share | 70MB |
| jobTypeB memory share | 30MB |
| jobTypeA memory slots | 7 |
| jobTypeB memory slots | 3 |

#### 18.4 Different Memory Estimates Per Job Type

**Config:**
```
model-alpha: TPM = 10,000,000
heavyJob: estimatedMemoryKB = 51,200 (50MB), ratio = 0.5
lightJob: estimatedMemoryKB = 5,120 (5MB), ratio = 0.5
Instance memory: 100MB
```

| What We Check | Expected Result |
|---------------|-----------------|
| heavyJob slots | 1 (minimum enforced) |
| lightJob slots | 5 |

#### 18.5 All Limit Types Applied Simultaneously

**Config:**
```
model-alpha: TPM = 50,000, RPM = 10, maxConcurrentRequests = 8
jobType: estimatedTokens = 10,000, estimatedRequests = 1, estimatedMemoryKB = 20,000
instances: 1
instance memory: 100MB
```

**Expected Calculation:**
```
TPM slots = floor(50,000 / 10,000) = 5
RPM slots = floor(10 / 1) = 10
Concurrent slots = 8
Memory slots = floor(100,000 / 20,000) = 5
Final = min(5, 10, 8, 5) = 5
```

| What We Check | Expected Result |
|---------------|-----------------|
| Effective slots | 5 |
| TPM and Memory are co-limiting factors | true |

---

## 19. Model Escalation - Basic

**File:** `modelEscalationBasic.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify basic model escalation behavior.

### Test Cases

#### 19.1 No Escalation When Primary Has Capacity

**Config:**
```
escalationOrder: ['model-alpha', 'model-beta']
model-alpha: capacity = 5
```

| What We Check | Expected Result |
|---------------|-----------------|
| Model used | model-alpha |
| Escalation count | 0 |

#### 19.2 Escalation to Second Model on Capacity Exhaustion

**Config:**
```
escalationOrder: ['model-alpha', 'model-beta']
model-alpha: capacity = 0 (exhausted)
model-beta: capacity = 10
maxWaitMS: { 'model-alpha': 0 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Model used | model-beta |
| Escalation count | 1 |
| Job completed | Yes |

#### 19.3 Escalation to Third Model

**Config:**
```
escalationOrder: ['model-alpha', 'model-beta', 'model-gamma']
model-alpha: capacity = 0
model-beta: capacity = 0
model-gamma: capacity = 10
maxWaitMS: { all models: 0 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Model used | model-gamma |
| Escalation count | 2 |

#### 19.4 Escalation Follows Defined Order

**Config:**
```
escalationOrder: ['gamma', 'alpha', 'beta']  // Non-alphabetical
All models: capacity = 0 except last
```

| Attempt | Model |
|---------|-------|
| 1st | gamma |
| 2nd | alpha |
| 3rd | beta |

#### 19.5 Single Model - No Escalation Possible

**Config:**
```
escalationOrder: ['alpha']
alpha: capacity = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| Escalation attempts | 0 |
| Job status | Rejected |

#### 19.6 Job Rejects When All Models Exhausted

**Config:**
```
escalationOrder: ['alpha', 'beta', 'gamma']
All models: capacity = 0
maxWaitMS: { all: 0 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Job status | Rejected |
| Error message | "All models exhausted" |

---

## 20. Model Escalation - Rate Limit Types

**File:** `modelEscalationRateLimits.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify escalation triggered by different rate limit types.

### Test Cases

#### 20.1 TPM Exhaustion Triggers Escalation

**Config:**
```
model-alpha: TPM = 50,000
model-beta: TPM = 500,000
maxWaitMS: { 'model-alpha': 0 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Escalation trigger | TPM exhausted |
| Model used | model-beta |

#### 20.2 RPM Exhaustion Triggers Escalation

**Config:**
```
model-alpha: RPM = 10
model-beta: RPM = 100
maxWaitMS: { 'model-alpha': 0 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Escalation trigger | RPM exhausted |
| Model used | model-beta |

#### 20.3 Concurrent Limit Triggers Escalation

**Config:**
```
model-alpha: maxConcurrentRequests = 5
model-beta: maxConcurrentRequests = 50
maxWaitMS: { 'model-alpha': 0 }
Job duration: 60000ms (long running)
```

| What We Check | Expected Result |
|---------------|-----------------|
| Escalation trigger | Concurrent exhausted |
| Model used | model-beta |

---

## 21. Model Escalation - Timeout

**File:** `modelEscalationTimeout.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify escalation after maxWaitMS timeout.

### Test Cases

#### 21.1 Escalation After maxWaitMS Timeout

**Config:**
```
escalationOrder: ['model-alpha', 'model-beta']
model-alpha: TPM = 50,000 (full)
maxWaitMS: { 'model-alpha': 5000 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Wait time on alpha | 5,000ms (±500ms) |
| Model used | model-beta |

#### 21.2 Multiple Timeout Escalations

**Config:**
```
escalationOrder: ['alpha', 'beta', 'gamma']
maxWaitMS: { 'alpha': 5000, 'beta': 3000 }
All models: capacity = 0
```

| Time | Model | Event |
|------|-------|-------|
| 0-5000ms | alpha | Waiting |
| 5000ms | beta | Escalated |
| 5000-8000ms | beta | Waiting |
| 8000ms | gamma | Escalated |

#### 21.3 Reject After All Timeouts

**Config:**
```
escalationOrder: ['alpha', 'beta']
maxWaitMS: { 'alpha': 5000, 'beta': 3000 }
All models: capacity = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| Total wait time | 8,000ms (±500ms) |
| Job status | Rejected |

#### 21.4 Escalation When Capacity Becomes Available Mid-Wait

**Config:**
```
maxWaitMS: { 'alpha': 60000 }
```

**Scenario:**
1. alpha full, job queued
2. After 5s, alpha capacity frees

| What We Check | Expected Result |
|---------------|-----------------|
| Model used | alpha |
| Escalation occurred | No |

---

## 22. Model Escalation - Capacity Tracking

**File:** `modelEscalationCapacityTracking.test.ts`

**Complexity:** Medium-High

**Purpose:** Verify capacity tracking during escalation.

### Test Cases

#### 22.1 Primary Model Not Charged When Escalating

**Config:**
```
model-alpha: capacity = 0
model-beta: capacity = 10
```

| Model | Usage After Escalation |
|-------|------------------------|
| alpha | 0 |
| beta | 10,000 tokens (or estimated) |

#### 22.2 Partial Usage on Primary Before Escalation via reject()

**Scenario:**
1. Job starts on alpha
2. Job makes API call, uses 5000 tokens
3. Job calls reject({ tokens: 5000, ... }, { delegate: true })
4. Job escalates to beta

| Model | Usage |
|-------|-------|
| alpha | 5,000 tokens |
| beta | Job's usage |

#### 22.3 Same Job Not Counted Twice

**Scenario:**
1. Job reserves 10,000 tokens on alpha
2. Escalates to beta (alpha reservation released)
3. Job reserves 10,000 tokens on beta

| Model | Final Usage |
|-------|-------------|
| alpha | 0 (or actual from reject) |
| beta | 10,000 |

#### 22.4 Callback Receives Escalated Model ID

**Config:**
```
escalationOrder: ['alpha', 'beta']
alpha: capacity = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| modelId in callback | 'model-beta' |

---

## 23. Instance Scaling Test

**File:** `instanceScaling.test.ts`

**Complexity:** High

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

## 24. Two-Layer Acquire/Release

**File:** `twoLayerAcquireRelease.test.ts`

**Complexity:** High

**Purpose:** Verify local-then-Redis acquire pattern.

### Test Cases

#### 24.1 Two-Layer Check - Local Then Redis

**Config:**
```
Instance A:
  pools['model-alpha'].totalSlots = 10
  Local ratios: jobTypeA = 0.5 (5 local slots), jobTypeB = 0.5
```

**Scenario:**
1. Submit 6 jobTypeA jobs
2. First 5 should acquire (local limit)
3. 6th should wait (local jobTypeA full, even though pool has capacity)

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA running | 5 |
| jobTypeA queued | 1 |
| Pool slots used | 5 |
| Pool slots available | 5 |

#### 24.2 In-Flight Constraint Enforced Locally

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.6
jobTypeB: estimatedTokens = 10,000, ratio = 0.4
2 instances
jobTypeA slots: 3, jobTypeB slots: 2
```

**Scenario:**
1. Send 3 long-running jobTypeA jobs (fills jobTypeA capacity)
2. Send 1 jobTypeA job (should wait)
3. Send 1 jobTypeB job (should start immediately)

| What We Check | Expected Result |
|---------------|-----------------|
| First 3 jobTypeA jobs started | true |
| 4th jobTypeA job waiting | true |
| jobTypeB job started | true (different job type, has capacity) |
| In-flight count jobTypeA | 3 |
| In-flight count jobTypeB | 1 |

#### 24.3 Release Decrements In-Flight Counter

**Config:**
```
model-alpha: maxConcurrentRequests = 10
jobType: estimatedRequests = 1
instances: 1
```

| What We Check | Expected Result |
|---------------|-----------------|
| After acquire: in-flight | 10 |
| After release: in-flight | 7 |
| New acquires succeed after release | true |

---

## 25. Multi-Model Independence

**File:** `multiModelIndependence.test.ts`

**Complexity:** High

**Purpose:** Verify models have independent pools.

### Test Cases

#### 25.1 Multiple Models Have Independent Pools

**Config:**
```
model-alpha: TPM = 100,000
model-beta: TPM = 50,000
model-gamma: maxConcurrentRequests = 20
jobTypeA: estimatedTokens = 10,000
2 instances
```

| What We Check | Expected Result |
|---------------|-----------------|
| pools['model-alpha'].totalSlots | 5 |
| pools['model-beta'].totalSlots | 2 |
| pools['model-gamma'].totalSlots | 10 |
| Each pool independent | true |

#### 25.2 Acquiring on Model A Does Not Affect Model B

**Scenario:**
1. Acquire all 5 slots on model-alpha
2. Verify model-beta still has all slots available

| Model | Available After model-alpha Full |
|-------|----------------------------------|
| model-alpha | 0 |
| model-beta | Full capacity |

#### 25.3 Same Ratios Applied Per Model

**Config:**
```
model-alpha: 10 pool slots
model-beta: 20 pool slots
jobTypeA: ratio = 0.6
jobTypeB: ratio = 0.4
```

| Model | jobTypeA slots | jobTypeB slots |
|-------|----------------|----------------|
| alpha | 6 | 4 |
| beta | 12 | 8 |

---

## 26. Multi-Resource Adjustment

**File:** `multiResourceAdjustment.test.ts`

**Complexity:** High

**Purpose:** Verify TPM/RPM/TPD/RPD adjust together.

### Test Cases

#### 26.1 All Resource Types Adjusted Together

**Config:**
```
model-alpha: TPM=100000, RPM=500, TPD=1000000, RPD=10000
```

**Scenario:**
1. Job estimated: tokens=10000, requests=5
2. Job actual: tokens=6000, requests=3

| Counter | Adjustment | Amount |
|---------|------------|--------|
| TPM | Refund | 4,000 |
| RPM | Refund | 2 |
| TPD | Refund | 4,000 |
| RPD | Refund | 2 |

#### 26.2 Mixed Refund and Overage

**Scenario:**
1. Job estimated: tokens=10000, requests=1
2. Job actual: tokens=6000, requests=3

| Counter | Direction | Amount |
|---------|-----------|--------|
| TPM/TPD | Refund | 4,000 |
| RPM/RPD | Overage | 2 |

---

## 27. Time Window Handling

**File:** `timeWindowHandling.test.ts`

**Complexity:** High

**Purpose:** Verify time-window-aware refund/overage behavior.

### Test Cases

#### 27.1 Job Completes 1ms Before Window End

**Scenario:**
1. Job starts at T=10:00:30
2. Job completes at T=10:00:59.999

| What We Check | Expected Result |
|---------------|-----------------|
| Refund occurred | Yes |

#### 27.2 Job Completes 1ms After Window End

**Scenario:**
1. Job starts at T=10:00:55
2. Job completes at T=10:01:00.001

| What We Check | Expected Result |
|---------------|-----------------|
| Refund occurred | No |
| Window 10:00 counter | 10,000 (estimated, unchanged) |

#### 27.3 Job Carries Window Start Metadata

**Scenario:**
1. Job starts at T=10:00:45
2. Job completes at T=10:00:52

| What We Check | Expected Result |
|---------------|-----------------|
| tpmWindowStart | Start of minute (10:00:00) |
| rpmWindowStart | Start of minute (10:00:00) |

#### 27.4 Cross-Window Job Has Original Window

**Scenario:**
1. Job starts at T=10:00:55
2. Job completes at T=10:01:10

| What We Check | Expected Result |
|---------------|-----------------|
| tpmWindowStart | 10:00:00 (not 10:01:00) |

---

## 28. Distributed - Instance Scaling

**File:** `distributedInstanceScaling.test.ts`

**Complexity:** High

**Purpose:** Verify instance join/leave in distributed mode.

### Test Cases

#### 28.1 Instance Join - Slots Halve Immediately

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
```

**Scenario:**
1. Instance A boots alone
2. Verify A has 10 slots
3. Instance B boots
4. Verify A now has 5 slots, B has 5 slots

| Phase | Instance | totalSlots | instanceCount |
|-------|----------|------------|---------------|
| After A boots | A | 10 | 1 |
| After B boots | A | 5 | 2 |
| After B boots | B | 5 | 2 |

#### 28.2 Instance Leave - Slots Double After Heartbeat Timeout

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
heartbeatIntervalMs: 5000
staleInstanceThresholdMs: 15000
```

**Scenario:**
1. Instance A and B running (5 slots each)
2. Kill instance B
3. Wait for staleInstanceThresholdMs

| Phase | Instance A totalSlots | instanceCount |
|-------|-----------------------|---------------|
| Before B killed | 5 | 2 |
| After stale threshold | 10 | 1 |

#### 28.3 Heartbeat Maintains Instance Registration

**Config:**
```
heartbeatIntervalMs: 2000
staleInstanceThresholdMs: 6000
instances: 2
```

**Scenario:**
1. Boot both instances
2. Wait 10 seconds (multiple heartbeat cycles)

| What We Check | Expected Result |
|---------------|-----------------|
| Both instances still registered | true |
| allocation.instanceCount | 2 |
| Pool slots still divided by 2 | true |

#### 28.4 Stale Instance Cleanup

**Config:**
```
heartbeatIntervalMs: 1000
staleInstanceThresholdMs: 3000
instances: 2
```

**Scenario:**
1. Boot instances A and B
2. Pause instance B's heartbeat (kill without graceful shutdown)
3. Wait for staleInstanceThresholdMs + buffer

| What We Check | Expected Result |
|---------------|-----------------|
| allocation.instanceCount | 1 (B removed) |
| Instance A's slots doubled | true |
| Cleanup happened automatically | true |

#### 28.5 Instance Unregistration Returns Slots to Pool

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
Stale threshold: 15 seconds
```

**Scenario:**
1. Instance A acquires 3 slots
2. Kill instance A (without graceful shutdown)
3. Wait for stale threshold + cleanup

| What We Check | Expected Result |
|---------------|-----------------|
| Instance A acquired 3 slots | true |
| After kill, instance B allocation | eventually doubles |
| Pool slots returned | true |
| Instance count | 1 (only B remains) |

---

## 29. Distributed - Global Usage Tracking

**File:** `distributedGlobalUsageTracking.test.ts`

**Complexity:** High

**Purpose:** Verify global usage accumulates across instances.

### Test Cases

#### 29.1 Multiple Jobs Accumulate Correctly

**Scenario:**
1. Instance A completes job: 5,000 tokens
2. Instance B completes job: 3,000 tokens
3. Instance A completes job: 2,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| globalActualTokensThisMinute | 10,000 |

#### 29.2 Global Usage Counter Increments Across Instances

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances (A and B)
Pool capacity: 5 slots per instance
```

**Scenario:**
1. Send 3 jobs to instance A (each returns 10,000 tokens actual)
2. Send 2 jobs to instance B (each returns 10,000 tokens actual)

| What We Check | Expected Result |
|---------------|-----------------|
| All 5 jobs complete | true |
| Global TPM counter in Redis | 50,000 tokens |
| Instance A contribution | 30,000 tokens |
| Instance B contribution | 20,000 tokens |

#### 29.3 Concurrent Updates Are Atomic

**Scenario:**
1. Instance A and B each complete 10 jobs simultaneously
2. Each job uses exactly 1,000 tokens
3. Total = 20 jobs * 1,000 = 20,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| globalActualTokensThisMinute | 20,000 |

#### 29.4 Remaining Capacity Decreases After Usage

**Config:**
```
model-alpha: TPM = 100,000
instanceCount = 2
```

**Scenario:**
1. Initial: Each instance has 50,000 TPM allocated
2. Instance A uses 10,000 tokens
3. Remaining = 100,000 - 10,000 = 90,000
4. Per instance = 90,000 / 2 = 45,000

| Phase | Remaining TPM per Instance |
|-------|---------------------------|
| Initial | 50,000 |
| After 10K used | 45,000 |

#### 29.5 Zero Remaining Capacity Blocks New Jobs

**Config:**
```
model-alpha: TPM = 100,000
instanceCount = 2
```

**Scenario:**
1. Instance A uses 50,000 tokens
2. Instance B uses 50,000 tokens
3. Global usage = 100,000 (exhausted)

| What We Check | Expected Result |
|---------------|-----------------|
| Remaining capacity | 0 |
| New job status | Queued (not running) |

#### 29.6 Allocation Uses Remaining Capacity Formula

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Use 60,000 tokens globally (remaining: 40,000)
2. Query allocations

| What We Check | Expected Result |
|---------------|-----------------|
| Global remaining | 40,000 tokens |
| Instance A allocation | 20,000 tokens |
| Instance B allocation | 20,000 tokens |
| Instance A slots | floor(20,000 / 10,000) = 2 |
| Instance B slots | floor(20,000 / 10,000) = 2 |

---

## 30. Distributed - Cross-Instance Propagation

**File:** `distributedCrossInstancePropagation.test.ts`

**Complexity:** High

**Purpose:** Verify overages/refunds propagate to all instances.

### Test Cases

#### 30.1 Overage on One Instance Reduces Allocation for All

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
Initial allocation: 50,000 TPM per instance
```

**Scenario:**
1. Send 5 jobs to instance A, each returning 15,000 tokens (75,000 total)
2. Wait for Redis to broadcast new allocations

| What We Check | Expected Result |
|---------------|-----------------|
| Instance A jobs complete | true |
| Global TPM used | 75,000 tokens |
| Remaining global capacity | 25,000 tokens |
| Instance B new TPM allocation | 12,500 tokens |
| Instance B available slots | floor(12,500 / 10,000) = 1 slot |

#### 30.2 Underuse on One Instance Increases Available Capacity

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Send 5 jobs to instance A, each returning 5,000 tokens (25,000 total)

| What We Check | Expected Result |
|---------------|-----------------|
| Global TPM used | 25,000 tokens |
| Global remaining | 75,000 tokens |
| Per-instance allocation | 37,500 TPM each |

#### 30.3 Three Instances Fair Reduction

**Config:**
```
model-alpha: TPM = 90,000
instanceCount = 3
Initial allocation: 30,000 TPM each
```

**Scenario:**
1. Instance A uses 45,000 tokens (15,000 overage)
2. Remaining = 90,000 - 45,000 = 45,000
3. Per instance = 45,000 / 3 = 15,000

| Instance | TPM Allocation After |
|----------|---------------------|
| A | 15,000 |
| B | 15,000 |
| C | 15,000 |

#### 30.4 Cumulative Overages Progressively Reduce Capacity

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Send jobs in sequence, each with 2,000 token overage

| After Job | Remaining | Per-Instance |
|-----------|-----------|--------------|
| Job 1 (12K used) | 88,000 | 44,000 |
| Job 2 (24K used) | 76,000 | 38,000 |
| Job 3 (36K used) | 64,000 | 32,000 |
| Job 8 (96K used) | 4,000 | 2,000 |
| Job 9 | Must wait for rate limit reset |

#### 30.5 Mixed Usage Patterns Across Instances

**Config:**
```
model-alpha: TPM = 120,000
jobTypeA: estimatedTokens = 10,000
3 instances (A, B, C)
Initial allocation: 40,000 TPM per instance
```

**Scenario:**
1. Instance A: 4 jobs returning 15,000 each (60,000 total)
2. Instance B: 2 jobs returning 5,000 each (10,000 total)
3. Instance C: 3 jobs returning 10,000 each (30,000 total)

| What We Check | Expected Result |
|---------------|-----------------|
| Global actual usage | 100,000 tokens |
| Remaining capacity | 20,000 tokens |
| Per-instance allocation | 6,666 tokens each |
| Each instance slots | 0 slots (6,666 / 10,000 = 0) |

#### 30.6 Refund Propagates to Other Instances

**Config:**
```
instanceCount = 2
```

**Scenario:**
1. Instance A completes job, 4000 tokens refunded
2. Global counter updates

| Instance | Available Capacity Change |
|----------|---------------------------|
| A | +2000 (half of refund) |
| B | +2000 (half of refund) |

#### 30.7 Overage Propagates to Other Instances

**Scenario:**
1. Instance A has 5000 token overage
2. Global remaining decreases by 5000

| Instance | Capacity Reduction |
|----------|-------------------|
| B | 2500 (half of overage) |

---

## 31. Distributed - Pub/Sub

**File:** `distributedPubSub.test.ts`

**Complexity:** High

**Purpose:** Verify pub/sub allocation broadcasts.

### Test Cases

#### 31.1 Job Completion Triggers Allocation Broadcast

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Send 1 job to instance A
2. Job completes with actual usage
3. Check if instance B received allocation update

| What We Check | Expected Result |
|---------------|-----------------|
| Job completes | true |
| Instance B received pub/sub message | true |
| Message contains updated allocation | true |
| Message contains dynamicLimits | true |

#### 31.2 All Instances Receive Allocation Update

**Config:**
```
instanceCount = 3
```

**Scenario:**
1. Instance A completes job with usage

| Instance | Received Update |
|----------|-----------------|
| B | Yes |
| C | Yes |

#### 31.3 Instance Receives Own Allocation

**Scenario:**
1. Instance A completes job

| What We Check | Expected Result |
|---------------|-----------------|
| Instance A receives update | Yes |

#### 31.4 Pub/Sub Message Contains Complete Allocation Info

**Config:**
```
model-alpha: TPM = 100,000, RPM = 500
model-beta: TPM = 50,000
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 2
2 instances
```

| What We Check | Expected Result |
|---------------|-----------------|
| message.instanceCount | 2 |
| message.pools['model-alpha'].totalSlots | number > 0 |
| message.pools['model-alpha'].tokensPerMinute | number > 0 |
| message.pools['model-alpha'].requestsPerMinute | number > 0 |
| message.pools['model-beta'].totalSlots | number > 0 |
| message.dynamicLimits exists | true |
| message.dynamicLimits['model-alpha'].tokensPerMinute | number > 0 |

#### 31.5 Release Updates Global Usage and Triggers Reallocation

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Send 1 job that completes with 8,000 tokens actual

| What We Check | Expected Result |
|---------------|-----------------|
| Global usage counter updated | true |
| Global counter value | 8,000 tokens |
| Pub/sub message broadcast | true |
| Both instances received new allocation | true |

---

## 32. Distributed - Dynamic Limits

**File:** `distributedDynamicLimits.test.ts`

**Complexity:** High

**Purpose:** Verify dynamic limits update local rate limiters.

### Test Cases

#### 32.1 Dynamic Limits Update Local Rate Limiters

**Scenario:**
1. Initial allocation: 50,000 TPM
2. After usage: dynamicLimits.tokensPerMinute = 30,000

| What We Check | Initial | After Update |
|---------------|---------|--------------|
| Local TPM limit | 50,000 | 30,000 |

#### 32.2 DynamicLimits Applied to Local Rate Limiters

**Config:**
```
model-alpha: TPM = 100,000
jobType: estimatedTokens = 10,000
instances: 2
```

**Scenario:**
1. Instance A uses 60,000 tokens (overage)
2. Query instance B's local rate limiter state

| What We Check | Expected Result |
|---------------|-----------------|
| Instance B's local tokensPerMinute | floor(40,000 / 2) = 20,000 |
| Instance B can only queue 2 jobs | 2 (20,000 / 10,000) |
| 3rd job on B | must wait or delegate |

#### 32.3 Pool Slots Recalculated With Dynamic Limits

**Config:**
```
model-alpha: TPM = 100,000
estimatedTokens = 10,000
instanceCount = 2
```

**Scenario:**
1. Initial: 50,000 TPM / 10,000 = 5 slots per instance
2. After 20,000 tokens used: 80,000 remaining / 2 = 40,000 per instance

| Phase | Slots per Instance |
|-------|-------------------|
| Initial | 5 |
| After 20K used | 4 |

#### 32.4 Dynamic Limits Propagated to Local Rate Limiters

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. Use 60,000 tokens globally → remaining 40,000

| What We Check | Expected Result |
|---------------|-----------------|
| Global remaining | 40,000 tokens |
| Instance local TPM limit | 20,000 tokens (40,000 / 2) |
| Local rate limiter enforces 20,000 TPM | true |

---

## 33. Distributed - Time Windows

**File:** `distributedTimeWindows.test.ts`

**Complexity:** High

**Purpose:** Verify time window resets in distributed mode.

### Test Cases

#### 33.1 Window Reset Clears Global Counters

**Config:**
```
model-alpha: TPM = 50,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. In minute N: Send 4 jobs total (40,000 tokens used)
2. Wait for minute N+1 to begin

| What We Check | Expected Result |
|---------------|-----------------|
| Minute N counter | 40,000 tokens |
| Minute N+1 counter | 0 tokens (fresh window) |
| Both instances receive full allocation | true |
| Per-instance TPM in minute N+1 | 25,000 each |

#### 33.2 Full Allocation Restored After Window Reset

**Config:**
```
model-alpha: TPM = 100,000
instanceCount = 2
```

**Scenario:**
1. Both instances use 25,000 tokens (50,000 total)
2. Wait for minute boundary

| Phase | TPM per Instance |
|-------|-----------------|
| After usage | 25,000 |
| After window reset | 50,000 |

#### 33.3 Daily Limit (TPD) Tracked Across Minutes

**Config:**
```
model-alpha: TPM = 100,000, TPD = 200,000
jobType: estimatedTokens = 10,000
instances: 2
```

**Scenario:**
1. Minute M: Use 80,000 tokens
2. Minute M+1: Use 80,000 tokens
3. Minute M+2: Try to use 50,000 tokens

| What We Check | Expected Result |
|---------------|-----------------|
| After minute M: TPD counter | 80,000 |
| After minute M+1: TPD counter | 160,000 |
| Minute M+2: Tokens available | 40,000 (200,000 - 160,000) |
| Jobs exceeding daily limit | Must wait for next day |

#### 33.4 Daily Limit Reset at Day Boundary

**Config:**
```
model-alpha: TPD = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
```

**Scenario:**
1. On day N: Consume 80,000 tokens
2. Wait for day N+1 to begin

| What We Check | Expected Result |
|---------------|-----------------|
| Day N TPD counter | 80,000 tokens |
| Day N+1 TPD counter | 0 tokens (fresh day) |
| Full allocation restored | true |

---

## 34. Distributed - Request Count Tracking

**File:** `distributedRequestCountTracking.test.ts`

**Complexity:** High

**Purpose:** Verify RPM/RPD tracked separately from TPM/TPD.

### Test Cases

#### 34.1 RPM Tracking Separate from TPM

**Config:**
```
model-alpha: TPM = 100,000, RPM = 50
jobTypeA: estimatedTokens = 10,000, estimatedRequests = 2
2 instances
```

**Scenario:**
1. Send 10 jobs returning requestCount: 3 and 8,000 tokens each

| What We Check | Expected Result |
|---------------|-----------------|
| Global TPM counter | 80,000 tokens (10 x 8,000) |
| Global RPM counter | 30 requests (10 x 3) |
| Remaining TPM | 20,000 tokens |
| Remaining RPM | 20 requests |

#### 34.2 Request Count (RPM/RPD) Tracked Separately

**Config:**
```
model-alpha: TPM = 1,000,000, RPM = 100, TPD = 10,000,000, RPD = 1000
jobType: estimatedTokens = 1000, estimatedRequests = 1
instances: 2
```

**Scenario:**
1. Send 80 jobs from instance A (80 requests, 80,000 tokens)

| What We Check | Expected Result |
|---------------|-----------------|
| actualTokens (TPM window) | 80,000 |
| actualRequests (RPM window) | 80 |
| actualTokens (TPD window) | 80,000 |
| actualRequests (RPD window) | 80 |
| All four counters tracked independently | true |

#### 34.3 RPM Counter Increments by Request Count

**Scenario:**
1. Job completes with requestCount = 3

| What We Check | Expected Result |
|---------------|-----------------|
| globalActualRequestsThisMinute increment | 3 |

#### 34.4 Multi-Request Job Affects Both TPM and RPM

**Scenario:**
1. Job completes: tokens = 15,000, requestCount = 3

| Counter | Increment |
|---------|-----------|
| globalActualTokensThisMinute | 15,000 |
| globalActualRequestsThisMinute | 3 |

---

## 35. Distributed - Multi-Model Tracking

**File:** `distributedMultiModelTracking.test.ts`

**Complexity:** High

**Purpose:** Verify per-model tracking in distributed mode.

### Test Cases

#### 35.1 Multiple Models Tracked Independently

**Config:**
```
model-alpha: TPM = 100,000
model-beta: TPM = 50,000
jobType: estimatedTokens = 10,000
instances: 2
```

**Scenario:**
1. Use 80,000 tokens on model-alpha (instance A)
2. Use 20,000 tokens on model-beta (instance A)
3. Query allocations on instance B

| What We Check | Expected Result |
|---------------|-----------------|
| model-alpha remaining | (100,000 - 80,000) / 2 = 10,000 per instance |
| model-beta remaining | (50,000 - 20,000) / 2 = 15,000 per instance |
| model-alpha usage does not affect model-beta | true |

---

## 36. Local Ratio Only Test

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
| Both instances have pool data | allocation.pools exists |
| Same pool allocation from Redis | pools['flex-model'].totalSlots equal on both |
| Pool not reduced by A's load | B's pool slots unchanged |

---

## 37. Distributed - Ratio Management

**File:** `distributedRatioManagement.test.ts`

**Complexity:** Highest

**Purpose:** Verify ratio changes not shared via Redis.

### Test Cases

#### 37.1 Ratio Changes Not Shared Via Redis

**Config:**
```
instanceCount = 2
Both start with equal ratios (0.33, 0.33, 0.34)
```

**Scenario:**
1. Instance A receives heavy flexJobA load
2. Instance A adjusts ratios locally
3. Instance B receives flexJobB jobs

| Instance | flexJobA ratio | Expected |
|----------|----------------|----------|
| A | Increased | > 0.33 |
| B | Unchanged | 0.33 (exact) |

#### 37.2 Each Instance Has Independent Ratios

**Scenario:**
1. Instance A: heavy flexJobA load → ratios favor flexJobA
2. Instance B: heavy flexJobB load → ratios favor flexJobB

| Instance | Dominant Ratio |
|----------|----------------|
| A | flexJobA |
| B | flexJobB |

#### 37.3 Pool Allocation Same Despite Different Ratios

**Config:**
```
pools['model-alpha'].totalSlots = 10 per instance
```

**Scenario:**
1. Instance A has ratios 0.7/0.3
2. Instance B has ratios 0.3/0.7

| Instance | Pool Slots |
|----------|-----------|
| A | 10 |
| B | 10 |

#### 37.4 Local Ratio Changes Don't Affect Redis

**Config:**
```
model-alpha: TPM = 100,000
flexJobA: ratio = 0.5
flexJobB: ratio = 0.5
2 instances
```

**Scenario:**
1. Query Redis pool allocation → 5 slots per instance
2. Trigger ratio adjustment on instance A
3. Query Redis pool allocation again

| What We Check | Expected Result |
|---------------|-----------------|
| Redis pool before adjustment | 5 slots per instance |
| Redis pool after adjustment | 5 slots per instance (unchanged) |
| Instance A local distribution changed | true |
| Instance B local distribution | unchanged |

---

## 38. Distributed - Memory Independence

**File:** `distributedMemoryIndependence.test.ts`

**Complexity:** Highest

**Purpose:** Verify memory constraints are local-only.

### Test Cases

#### 38.1 Memory Not Shared Via Redis

**Config:**
```
model-alpha: TPM = 1,000,000
jobTypeA: estimatedMemoryKB = 10,240 (10MB)
Instance A: 100MB memory (10 memory slots)
Instance B: 200MB memory (20 memory slots)
```

| Instance | Memory Slots |
|----------|-------------|
| A | 10 (100MB / 10MB) |
| B | 20 (200MB / 10MB) |

#### 38.2 Redis Allocation Unaware of Memory

**Config:**
```
model-alpha: TPM = 100,000
instanceCount = 2
Instance A: 50MB memory
Instance B: 500MB memory
```

| Instance | Redis Pool Slots |
|----------|-----------------|
| A | 5 |
| B | 5 |

#### 38.3 Different Memory Yields Different Final Slots

**Config:**
```
model-alpha: TPM = 1,000,000 (distributed gives 100 slots each)
Instance A: 50MB memory (5 memory slots)
Instance B: 200MB memory (20 memory slots)
estimatedMemoryKB = 10MB
```

| Instance | Distributed | Memory | Final Slots |
|----------|------------|--------|-------------|
| A | 100 | 5 | 5 |
| B | 100 | 20 | 20 |

---

## 39. Distributed - Acquire/Release

**File:** `distributedAcquireRelease.test.ts`

**Complexity:** Highest

**Purpose:** Verify Redis coordination for acquire/release.

### Test Cases

#### 39.1 Acquire Still Goes to Redis for Global Coordination

**Config:**
```
model-alpha: TPM = 20,000
jobTypeA: estimatedTokens = 10,000
2 instances
Pool: 1 slot per instance
```

**Scenario:**
1. Instance A acquires 1 slot → Redis pool decremented
2. Instance B acquires 1 slot → Redis pool decremented
3. Query Redis total in-flight count

| What We Check | Expected Result |
|---------------|-----------------|
| Instance A acquired | true |
| Instance B acquired | true |
| Redis total in-flight | 2 |
| Redis pool available | 0 |
| 3rd job from either instance | must wait |

#### 39.2 Acquire/Release Atomicity Under Concurrency

**Config:**
```
model-alpha: maxConcurrentRequests = 100
instances: 1
```

**Scenario:**
1. Launch 200 concurrent acquire requests
2. Count successful acquires
3. Release all successful acquires

| What We Check | Expected Result |
|---------------|-----------------|
| Exactly 100 acquires succeed | 100 |
| Exactly 100 acquires fail/wait | 100 |
| After all releases: in-flight | 0 |
| No slot leakage | true |

---

## 40. Distributed - Wait Queue

**File:** `distributedWaitQueue.test.ts`

**Complexity:** Highest

**Purpose:** Verify per-instance wait queues in distributed mode.

### Test Cases

#### 40.1 Wait Queue Per Instance

**Config:**
```
model-alpha: TPM = 20,000
jobType: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 30000 }
instances: 2 (each gets 10,000 TPM = 1 slot)
job duration: 3000ms
```

**Steps:**
1. Send job-1 to instance-A (fills A's capacity)
2. Send job-2 to instance-A (waits in A's queue)
3. Send job-3 to instance-B (gets B's slot immediately)
4. Send job-4 to instance-B (waits in B's queue)

| What We Check | Expected Result |
|---------------|-----------------|
| job-1 and job-3 start immediately | within 100ms |
| job-2 waits for job-1 | queue duration >= 2800ms |
| job-4 waits for job-3 | queue duration >= 2800ms |
| Instance A's queue does not affect Instance B | true |

#### 40.2 Rate Limit Reset Wakes Queue

**Scenario:**
1. TPM capacity exhausted
2. Job queued at :50
3. At :00 (window reset), job should wake

| What We Check | Expected Result |
|---------------|-----------------|
| Job wake time | :00 (window boundary) (±1s) |

#### 40.3 Backend Allocation Change Wakes Queue (Distributed)

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000, maxWaitMS: { 'model-alpha': 60000 }
```

**Setup:**
- Start with 2 instances (5 slots each)
- Fill capacity completely

**Steps:**
1. Boot infrastructure with 2 instances
2. Send 10 jobs to fill capacity
3. Send 1 additional job (will queue)
4. Kill 1 instance (remaining instance gets doubled allocation)
5. Verify queued job wakes up due to new allocation

| What We Check | Expected Result |
|---------------|-----------------|
| Additional job completes | true |
| Additional job queue duration | < 5000ms (woke up on reallocation) |
| Additional job model used | model-alpha |

---

## 41. Distributed - Escalation

**File:** `distributedEscalation.test.ts`

**Complexity:** Highest

**Purpose:** Verify escalation works across instances.

### Test Cases

#### 41.1 Escalation Works Across Instances

**Config:**
```
instanceCount = 2
model-alpha: TPM = 50,000 total (25,000 per instance)
model-beta: TPM = 500,000 total
```

**Scenario:**
1. Both instances fill model-alpha capacity
2. New job submitted
3. Job escalates to model-beta

| What We Check | Expected Result |
|---------------|-----------------|
| Escalation works in distributed | Yes |
| Model used | model-beta |

#### 41.2 Global Capacity Checked Before Escalation

**Config:**
```
instanceCount = 2
Instance A: 5000 TPM used
Instance B: 20000 TPM used
Global TPM = 25,000
```

**Scenario:**
1. Instance A has local capacity
2. But global is near limit

| What We Check | Expected Result |
|---------------|-----------------|
| Global capacity considered | Yes |

---

## 42. Distributed - Graceful Degradation

**File:** `distributedGracefulDegradation.test.ts`

**Complexity:** Highest

**Purpose:** Verify operation continues when Redis unavailable.

### Test Cases

#### 42.1 Graceful Degradation When Redis Unavailable

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
Allocation: 50,000 TPM per instance initially
```

**Scenario:**
1. Both instances running with 50,000 TPM each
2. Instance A uses 30,000 tokens (allocation becomes 35,000 each)
3. Disconnect Redis (simulate network partition)
4. Send more jobs to instance B

| What We Check | Expected Result |
|---------------|-----------------|
| Instance B continues operating | true |
| Instance B uses last-known allocation | 35,000 TPM |
| Jobs within last-known allocation complete | true |
| Jobs exceeding last-known allocation | wait/delegate |
| No automatic reset to original limits | true |

#### 42.2 Redis Recovery - Allocations Resume

**Scenario:**
1. Redis down, instances using last-known limits
2. Redis comes back

| What We Check | Expected Result |
|---------------|-----------------|
| Fresh allocation received | Yes |
| Allocation matches current global state | Yes |

#### 42.3 Eventual Consistency After Network Partition

**Config:**
```
model-alpha: TPM = 100,000
jobType: estimatedTokens = 10,000
instances: 2
```

**Scenario:**
1. Partition instance B from Redis
2. Instance A uses 60,000 tokens
3. Heal partition
4. Wait for instance B to receive update

| What We Check | Expected Result |
|---------------|-----------------|
| Before heal: Instance B allocation | 50,000 TPM (stale) |
| After heal: Instance B allocation | 20,000 TPM (converged) |
| Convergence time | < heartbeatIntervalMs + 500ms |

---

## 43. Redis Key Management

**File:** `redisKeyManagement.test.ts`

**Complexity:** Highest

**Purpose:** Verify Redis key TTL cleanup.

### Test Cases

#### 43.1 Redis Key TTL Auto-Cleanup

**Config:**
```
model-alpha: TPM = 100,000
instances: 1
```

**Scenario:**
1. Complete jobs in minute M
2. Wait 3 minutes (past TTL of 120 seconds)
3. Query Redis for minute M's key

| What We Check | Expected Result |
|---------------|-----------------|
| Key `{prefix}usage:model-alpha:tpm:{minuteM}` | does not exist |
| No manual cleanup required | true |

---

## 44. Zero Actual Usage

**File:** `zeroActualUsage.test.ts`

**Complexity:** Highest

**Purpose:** Verify full refund for zero actual usage.

### Test Cases

#### 44.1 Zero Actual Usage Handled Correctly

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
2 instances
Pool capacity: 5 slots per instance
```

**Steps:**
1. Boot infrastructure
2. Send 5 jobs that return: inputTokens: 0, outputTokens: 0, cachedTokens: 0, requestCount: 0
3. Wait for completion
4. Immediately send 10 more jobs

| What We Check | Expected Result |
|---------------|-----------------|
| First 5 jobs complete | true |
| TPM counter | 0 tokens |
| All 10 additional jobs start immediately | true (full capacity available) |

---

## 45. Job Priority

**File:** `jobPriority.test.ts`

**Complexity:** Highest

**Purpose:** Verify different job types have different wait behaviors.

### Test Cases

#### 45.1 Low Priority Fails Fast, Critical Waits

**Config:**
```
lowPriority: maxWaitMS: { 'model-alpha': 0 }
critical: maxWaitMS: { 'model-alpha': 60000 }
```

**Scenario:**
1. Fill capacity
2. Submit lowPriority job
3. Submit critical job

| Job Type | Behavior |
|----------|----------|
| lowPriority | Immediate delegation (±100ms) |
| critical | Queued |

#### 45.2 Mixed Job Types in Same Queue

**Scenario:**
1. Submit critical job (queued, 60s timeout)
2. Submit lowPriority job (should immediately delegate)
3. Submit another critical job (queued behind first)

| Job | Status |
|-----|--------|
| critical-1 | Queued, position 1 |
| lowPriority | Delegated (not queued) |
| critical-2 | Queued, position 2 |

---

## 46. High Concurrency

**File:** `highConcurrency.test.ts`

**Complexity:** Highest

**Purpose:** Verify global limits under high concurrency.

### Test Cases

#### 46.1 Global Limit Respected Under High Concurrency

**Config:**
```
model-alpha: TPM = 100,000
jobType: estimatedTokens = 1,000
instances: 3
```

**Scenario:**
1. Each instance sends 50 jobs simultaneously (150 total)

| What We Check | Expected Result |
|---------------|-----------------|
| Total jobs completed in first minute | <= 100 (100,000 / 1,000) |
| Sum of actual usage across all instances | <= 100,000 TPM |
| Excess jobs | wait for next minute or delegate |

#### 46.2 High-Volume Escalation

**Config:**
```
alpha: capacity = 10
beta: capacity = 100
```

**Scenario:**
1. Submit 50 jobs simultaneously

| Model | Jobs Running |
|-------|-------------|
| alpha | 10 |
| beta | 40 |

---

## 47. Edge Cases

**File:** `edgeCases.test.ts`

**Complexity:** Highest

**Purpose:** Verify edge cases work correctly.

### Test Cases

#### 47.1 Very Large Instance Count

**Config:**
```
model-alpha: TPM = 100,000
jobTypeA: estimatedTokens = 10,000
instanceCount = 100
```

| What We Check | Expected Result |
|---------------|-----------------|
| totalSlots per instance | 0 |
| tokensPerMinute per instance | 1,000 |

#### 47.2 Floor Rounding Guarantees Minimum Slot

**Config:**
```
model-alpha: TPM = 20,000
jobTypeA: estimatedTokens = 10,000, ratio = 0.1
jobTypeB: estimatedTokens = 10,000, ratio = 0.9
2 instances
Pool: floor((20,000 / 10,000) / 2) = 1 slot per instance
jobTypeA floor slots: floor(1 x 0.1) = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| jobTypeA calculated slots | 0 (from floor) |
| jobTypeA actual available | >= 1 (minJobTypeCapacity enforced) |
| jobTypeA can queue 1 job | true |

#### 47.3 Zero Memory Slots

**Config:**
```
Instance memory: 5MB
estimatedMemoryKB = 10MB
Memory slots = floor(5 / 10) = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| Memory slots | 0 |
| Jobs accepted | 0 (or queued) |

#### 47.4 Very Large Memory Estimate

**Config:**
```
Instance memory: 100MB
estimatedMemoryKB = 200MB
Memory slots = floor(100 / 200) = 0
```

| What We Check | Expected Result |
|---------------|-----------------|
| Memory slots | 0 |

#### 47.5 maxWaitMS = 1ms

**Config:**
```
maxWaitMS: { 'model-alpha': 1 }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Delegation time | ~1ms (±50ms) |

#### 47.6 maxWaitMS = Maximum Safe Integer

**Config:**
```
maxWaitMS: { 'model-alpha': Number.MAX_SAFE_INTEGER }
```

| What We Check | Expected Result |
|---------------|-----------------|
| Job queued without error | Yes |

#### 47.7 Only Fixed Job Types - No Adjustment

**Config:**
```
fixedA: ratio = 0.5, flexible = false
fixedB: ratio = 0.5, flexible = false
```

| What We Check | Expected Result |
|---------------|-----------------|
| Any adjustment occurred | No |
| Ratios unchanged | Yes |

#### 47.8 Single Flexible Job Type - No Self-Transfer

**Config:**
```
flexibleOnly: ratio = 1.0, flexible = true
```

| What We Check | Expected Result |
|---------------|-----------------|
| Ratio after adjustment | 1.0 (unchanged) |

#### 47.9 Job Type Preserved During Escalation

**Config:**
```
jobType: 'summary'
```

**Scenario:**
1. summary job submitted
2. Escalates alpha → beta
3. Job still tracked as 'summary' type on beta

| What We Check | Expected Result |
|---------------|-----------------|
| jobType after escalation | 'summary' |

---

## 48. Model Escalation Test (Legacy)

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

## 49. Model Escalation to Third Model Test (Legacy)

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
