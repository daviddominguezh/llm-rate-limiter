# High Complexity Tests

This document contains detailed documentation for tests with high complexity level.

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
