# Medium Complexity Tests

This document contains detailed documentation for tests with medium complexity level.

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
