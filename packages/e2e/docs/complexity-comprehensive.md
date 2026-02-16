# Comprehensive Mega Test

This document specifies the mega comprehensive test that covers ~50/52 features (96%) within a single 3-minute run.

---

## 50. Mega Comprehensive Test

**File:** `megaComprehensive.test.ts` + `megaComprehensiveAdditional.test.ts`

**Complexity:** Comprehensive (spans all complexity levels)

**Purpose:** Exercise nearly every feature of the rate limiter in a single test run, producing a testResult JSON for visualizer display.

**Config Preset:** `mega-comprehensive`

### Config Design

**3 Models** (escalation chain: alpha -> beta -> gamma):

| Model | TPM | RPM | Concurrent | TPD | RPD | Pricing (in/cached/out) |
|-------|-------|-----|-----------|---------|-----|------------------------|
| model-alpha | 30,000 | 6 | 3 | 500,000 | 200 | 0.01 / 0.005 / 0.03 |
| model-beta | 300,000 | 60 | 30 | - | - | 0.005 / 0.002 / 0.015 |
| model-gamma | 3,000,000 | 600 | 300 | - | - | 0.001 / 0.0005 / 0.003 |

**4 Job Types** (all estimatedTokens=10,000, estimatedRequests=1, estimatedMemoryKB=20,480):

| Job Type | Ratio | Flexible | maxWaitMS (alpha) | maxWaitMS (beta) | maxWaitMS (gamma) |
|----------|-------|----------|-------------------|-----------------|-------------------|
| critical | 0.4 | true | 30,000 | 15,000 | 5,000 |
| standard | 0.3 | true | 10,000 | 5,000 | 2,000 |
| lowPriority | 0.1 | true | 0 | 0 | 0 |
| fixedBatch | 0.2 | false | 30,000 | 15,000 | - |

**Memory:** freeMemoryRatio=0.8, maxMemoryKB=256,000 (200MB usable). Sized so the lowest-ratio job type (lowPriority at 0.1) gets floor(200MB x 0.1) = 20MB, exactly enough for one job.

**Ratio Adjustment:** adjustmentIntervalMs=10,000 (enabled for flexible types)

### Slot Calculations

#### Single Instance (model-alpha)

| Rate Dimension | Formula | Result |
|---------------|---------|--------|
| TPM | floor(30,000 / 10,000) | 3 |
| RPM | floor(6 / 1) | 6 |
| Concurrent | 3 | 3 |
| TPD | floor(500,000 / 10,000) | 50 |
| RPD | floor(200 / 1) | 200 |
| **Most restrictive** | min(3, 6, 3, 50, 200) | **3** |
| Memory | floor(200MB / 20MB) | 10 |
| **Final slots** | min(3, 10) | **3** |

#### JTM Ratio Distribution (3 total slots)

| Job Type | Ratio | Floor Slots | minJobTypeCapacity | Final |
|----------|-------|-------------|-------------------|-------|
| critical | 0.4 | floor(3 x 0.4) = 1 | - | 1 |
| standard | 0.3 | floor(3 x 0.3) = 0 | 1 | 1 |
| lowPriority | 0.1 | floor(3 x 0.1) = 0 | 1 | 1 |
| fixedBatch | 0.2 | floor(3 x 0.2) = 0 | 1 | 1 |

Note: minJobTypeCapacity ensures each type gets at least 1 slot.

#### Two Instances (model-alpha)

| Rate Dimension | Formula | Result |
|---------------|---------|--------|
| TPM | floor(30,000 / 10,000 / 2) | 1 |
| RPM | floor(6 / 1 / 2) | 3 |
| Concurrent | floor(3 / 2) | 1 |
| **Most restrictive** | min(1, 3, 1) | **1** |

---

### Test Phases (9 phases, ~170s total)

#### Phase 1: Slot Verification (~5s)

**Setup:** Boot 1 instance with `mega-comprehensive` preset.

**Steps:**
1. Fetch allocation from instance A
2. Verify pool slot count = 3 (most restrictive of 5 rate dimensions)
3. Verify memory slots = 4 (80MB / 20MB)
4. Verify final slots = min(3, 4) = 3
5. Verify JTM distribution: each type gets at least 1 slot (minJobTypeCapacity)
6. Verify fixedBatch marked as non-flexible

| What We Check | Expected Result |
|---------------|-----------------|
| Pool slots (model-alpha) | 3 |
| Memory slots | 4 |
| Final effective slots | 3 (TPM/concurrent wins over memory) |
| critical JTM slots | >= 1 |
| standard JTM slots | >= 1 |
| lowPriority JTM slots | >= 1 |
| fixedBatch JTM slots | >= 1 |

**Features covered:** Pool calculation, 5 rate dimensions, memory slot calculation, ratio distribution, fixed ratio protection, minJobTypeCapacity (floor rounding)

#### Phase 2: Fill Capacity + Queue + Escalation (~15s)

**Steps:**
1. Submit 3 `standard` jobs (fills model-alpha's 3 slots)
2. Submit 1 `critical` job (queues, maxWaitMS=30s)
3. Submit 1 `lowPriority` job (maxWaitMS=0, immediately escalates to model-beta)
4. Wait for first jobs to complete, verify queued critical job wakes

| What We Check | Expected Result |
|---------------|-----------------|
| 3 fill jobs accepted | HTTP 202 |
| critical job queues | queueDuration > 0 |
| lowPriority escalates | modelUsed = 'model-beta' |
| lowPriority queueDuration | < 200ms (immediate delegation) |
| critical wakes after fill | status = 'completed' |

**Features covered:** Queue behavior, maxWaitMS, two-layer acquire/release, model escalation, per-model maxWaitMS, job priority, escalation chain

#### Phase 3: Actual Usage (~10s)

**Steps:**
1. Submit job with actualInputTokens=3000, actualOutputTokens=2000 (5000 < 10000 estimated = refund)
2. Submit job with actualInputTokens=12000, actualOutputTokens=5000 (17000 > 10000 = overage)
3. Submit job with actualInputTokens=0, actualOutputTokens=0, actualRequestCount=0 (zero usage = full refund)
4. Submit job with actualInputTokens=3000, actualOutputTokens=2000, actualCachedTokens=1000 (token breakdown)
5. Verify stats (refunds, overages, cost calculations)

| What We Check | Expected Result |
|---------------|-----------------|
| Refund job (5000 actual) | Refund of 5000 tokens |
| Overage job (17000 actual) | Overage of 7000 tokens |
| Zero usage job | Full refund (10000 tokens) |
| Token breakdown | input=3000, output=2000, cached=1000 |
| Cost calculation | Uses model pricing: 3000*0.01 + 1000*0.005 + 2000*0.03 = 95 |
| onOverage callback fired | true |

**Features covered:** Actual usage refunds, actual usage overages, zero actual usage, token type breakdown, cost calculation, onOverage callback

#### Phase 4: Error Handling (~5s)

**Steps:**
1. Submit job with `shouldThrow: true` (throws without reject, no TPM release)
2. Submit job with `rejectUsage: { inputTokens: 2000, outputTokens: 1000, cachedTokens: 0, requestCount: 1 }` (reject with usage)
3. Verify capacity state after errors

| What We Check | Expected Result |
|---------------|-----------------|
| Throw job status | 'failed' |
| Throw: TPM not released | Counter not decremented |
| Reject job status | 'failed' |
| Reject: actual usage reported | 3000 total tokens tracked |

**Features covered:** Error throw without reject, error reject with usage

#### Phase 5: Flexible Ratio Adjustment (~15s)

**Steps:**
1. Submit heavy `critical` load (>70% utilization for critical type)
2. Keep `standard` idle (<30% utilization)
3. Verify ratio adjustment: standard donates to critical
4. Verify fixedBatch ratio unchanged (non-flexible)

| What We Check | Expected Result |
|---------------|-----------------|
| critical ratio increased | > 0.4 (initial) |
| standard ratio decreased | < 0.3 (donor) |
| fixedBatch ratio unchanged | 0.2 (exact) |
| Adjustment within maxAdjustment | true |

**Features covered:** Flexible ratio adjustment, donor/receiver algorithm, fixed ratio protection under adjustment

#### Phase 6: Scale to 2 Instances (~15s)

**Setup:** Boot instance B.

**Steps:**
1. Wait for allocation propagation (Pub/Sub broadcast)
2. Verify pool redistribution: model-alpha now 1 slot per instance
3. Fetch allocation from both instances
4. Verify memory is independent (each has own 4 memory slots)
5. Verify ratios NOT shared via Redis

| What We Check | Expected Result |
|---------------|-----------------|
| Instance count | 2 |
| model-alpha slots per instance | 1 |
| Memory slots (A) | 4 (independent) |
| Memory slots (B) | 4 (independent) |
| A's ratio adjustments not on B | true |

**Features covered:** Instance scaling, Pub/Sub notification, pool redistribution, memory independence, ratio local-only

#### Phase 7: Distributed Operations (~30s)

**Steps:**
1. Submit jobs to both instances, observe global usage tracking
2. Submit overage job on A, verify B's capacity reduced (cross-instance propagation)
3. Verify dynamic limits updated
4. Verify RPM dimension tracked across instances
5. Submit jobs to model-beta on both instances (multi-model tracking)
6. Verify distributed acquire/release coordination (both instances decrement Redis)
7. Submit 2 jobs per instance to verify independent wait queues

| What We Check | Expected Result |
|---------------|-----------------|
| Global usage counter | sum of both instances |
| Cross-instance propagation | B's available tokens reduced after A's overage |
| Dynamic limits updated | true |
| RPM tracking | request count tracked globally |
| Multi-model tracking | alpha and beta tracked independently |
| Distributed acquire | Redis pool decremented by both |
| Wait queue A independent of B | queue durations independent |

**Features covered:** Global usage tracking, cross-instance propagation, dynamic limits, RPM tracking, multi-model distributed tracking, distributed acquire/release, wait queue per instance

#### Phase 8: Allocation Change + Escalation (~15s)

**Steps:**
1. Fill capacity on instance A (1 slot occupied)
2. Submit job that queues on A
3. Kill instance B -> stale cleanup -> A gets 3 slots -> queued job wakes
4. Verify distributed escalation (submit job, model-alpha full -> model-beta)

| What We Check | Expected Result |
|---------------|-----------------|
| Instance count after kill | 1 |
| A's slots after reallocation | 3 |
| Queued job wakes | queueDuration < 5000ms |
| Escalation in distributed | modelUsed = 'model-beta' |

**Features covered:** Allocation change wakes queue, distributed escalation, stale instance cleanup, instance unregistration

#### Phase 9: Time Window Boundary (~60s)

**Steps:**
1. Wait for minute boundary (up to 60s)
2. Submit long-duration job just before minute N+1
3. Verify cross-window no-refund: job completes in minute N+1, no refund to minute N

| What We Check | Expected Result |
|---------------|-----------------|
| Job crosses minute boundary | true |
| No refund to window N | counter not decremented |

**Features covered:** Time window boundary, cross-window no-refund, time-window-aware adjustments

---

### Feature Coverage Summary

**50 / 52 features covered (96%)**

| # | Feature | Phase |
|---|---------|-------|
| 1 | Pool-based slot calculation | 1 |
| 2 | TPM rate dimension | 1 |
| 3 | RPM rate dimension | 1 |
| 4 | TPD rate dimension | 1 |
| 5 | RPD rate dimension | 1 |
| 6 | Concurrent rate dimension | 1 |
| 7 | Most restrictive wins | 1 |
| 8 | Memory slot calculation | 1 |
| 9 | freeMemoryRatio | 1 |
| 10 | Local ratio distribution | 1 |
| 11 | Fixed ratio protection | 1, 5 |
| 12 | minJobTypeCapacity (floor rounding) | 1 |
| 13 | Two-layer acquire/release | 2 |
| 14 | Queue behavior (maxWaitMS) | 2 |
| 15 | Model escalation (fallback chain) | 2 |
| 16 | Per-model maxWaitMS | 2 |
| 17 | Job priority (different wait behaviors) | 2 |
| 18 | Escalation chain of 3 models | 2 |
| 19 | Actual usage refunds | 3 |
| 20 | Actual usage overages | 3 |
| 21 | Zero actual usage (full refund) | 3 |
| 22 | Token type breakdown | 3 |
| 23 | Cost calculation | 3 |
| 24 | onOverage callback | 3 |
| 25 | Error: throw without reject | 4 |
| 26 | Error: reject with usage | 4 |
| 27 | Flexible ratio adjustment | 5 |
| 28 | Donor/receiver algorithm | 5 |
| 29 | Instance scaling (register) | 6 |
| 30 | Pub/Sub notification | 6 |
| 31 | Pool redistribution | 6 |
| 32 | Memory independence | 6 |
| 33 | Ratio local-only | 6 |
| 34 | Global usage tracking | 7 |
| 35 | Cross-instance propagation | 7 |
| 36 | Dynamic limits | 7 |
| 37 | RPM tracking (distributed) | 7 |
| 38 | Multi-model tracking (distributed) | 7 |
| 39 | Distributed acquire/release | 7 |
| 40 | Wait queue per instance | 7 |
| 41 | Allocation change wakes queue | 8 |
| 42 | Distributed escalation | 8 |
| 43 | Stale instance cleanup | 8 |
| 44 | Instance unregistration | 8 |
| 45 | Time window boundary | 9 |
| 46 | Cross-window no-refund | 9 |
| 47 | Time-window-aware adjustments | 9 |
| 48 | Default maxWaitMS calculation | 2 |
| 49 | Multi-model independence | 7 |
| 50 | Rate-window vs concurrency tracking | 1, 2 |

**Not covered (2):**
- Redis key TTL auto-cleanup (requires 120s+ idle wait)
- reject() + delegate to next model (not supported by mock job handler)

### Data Collection

Both test files use `TestDataCollector` + `StateAggregator` to capture SSE events and state snapshots. Output files:
- `packages/e2e/testResults/src/data/mega-comprehensive.json` (phases 1-5)
- `packages/e2e/testResults/src/data/mega-comprehensive-distributed.json` (phases 6-9)

Both datasets are available in the visualizer.
