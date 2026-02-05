# Highest Complexity Tests

This document contains detailed documentation for tests with the highest complexity level.

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
