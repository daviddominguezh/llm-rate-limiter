# Medium-High Complexity Tests

This document contains detailed documentation for tests with medium-high complexity level.

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
