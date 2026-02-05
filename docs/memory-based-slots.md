# Memory-Based Slot Calculation

This document explains how memory constraints affect slot allocation in the distributed rate limiter.

## Overview

The rate limiter calculates available slots using multiple limiting factors. Memory is a **local constraint** that each instance applies independently, while other limits (TPM, RPM, etc.) are **distributed** across instances via the backend.

```
Final Slots = min(Distributed Allocation, Local Memory Slots)
```

## Architecture

### Distributed Limits (Coordinated via Backend)

These limits are divided across all instances:

| Limit Type | Description | Formula |
|------------|-------------|---------|
| TPM | Tokens per minute | `floor(TPM / estimatedTokens / instanceCount * ratio)` |
| TPD | Tokens per day | `floor(TPD / estimatedTokens / instanceCount * ratio)` |
| RPM | Requests per minute | `floor(RPM / estimatedRequests / instanceCount * ratio)` |
| RPD | Requests per day | `floor(RPD / estimatedRequests / instanceCount * ratio)` |
| Concurrent | Max concurrent requests | `floor(maxConcurrent / instanceCount * ratio)` |

The distributed backend calculates these and pushes allocation to each instance.

### Local Limits (Per-Instance)

Memory is **not distributed** because it's a physical constraint of each instance:

| Limit Type | Description | Formula |
|------------|-------------|---------|
| Memory | Available heap memory | `floor(memoryForJobType / estimatedMemoryKB)` |

Each instance calculates its own memory-based slots and takes the **minimum** of distributed and local.

## Slot Calculation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     DISTRIBUTED BACKEND                          │
│                                                                  │
│  Calculates slots based on TPM/RPM/TPD/RPD/Concurrent           │
│  Divides by instanceCount, applies ratio                         │
│  Pushes allocation to each instance                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     INSTANCE (Local)                             │
│                                                                  │
│  1. Receives distributed allocation per job type                 │
│  2. Calculates local memory slots per job type                   │
│  3. Final slots = min(distributed, local memory)                 │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Slot Calculation

### Step 1: Determine Available Instance Memory

The instance's available memory can be:
- Detected from system heap (`process.memoryUsage()`)
- Constrained via `NODE_OPTIONS='--max-old-space-size=MB'`

### Step 2: Apply Ratio to Get Memory Per Job Type

Each job type gets a portion of total memory based on its ratio:

```
memoryForJobType = totalInstanceMemory × jobTypeRatio
```

### Step 3: Calculate Memory-Based Slots

```
localMemorySlots = floor(memoryForJobType / estimatedMemoryKB)
```

### Step 4: Apply Minimum with Distributed Allocation

```
finalSlots = min(distributedSlots, localMemorySlots)
```

## Example

### Configuration

```
Instance Memory: 100MB
Instances: 2

Model Config:
  - model-alpha: TPM = 1,000,000

Job Types:
  - jobTypeA: estimatedTokens = 10,000, estimatedMemoryKB = 10,240 (10MB), ratio = 0.5
  - jobTypeB: estimatedTokens = 10,000, estimatedMemoryKB = 1,024 (1MB), ratio = 0.5
```

### Distributed Calculation (TPM-based)

```
jobTypeA distributed slots = floor((1,000,000 / 10,000) / 2 * 0.5) = floor(25) = 25
jobTypeB distributed slots = floor((1,000,000 / 10,000) / 2 * 0.5) = floor(25) = 25
```

### Local Memory Calculation

```
Total instance memory: 100MB

Memory per job type (using ratio):
  jobTypeA memory = 100MB × 0.5 = 50MB
  jobTypeB memory = 100MB × 0.5 = 50MB

Local memory slots:
  jobTypeA = floor(50MB / 10MB) = 5 slots
  jobTypeB = floor(50MB / 1MB) = 50 slots
```

### Final Slot Allocation

```
jobTypeA final = min(distributed=25, local=5) = 5 slots   ← Memory limited
jobTypeB final = min(distributed=25, local=50) = 25 slots ← TPM limited
```

## Key Principles

### 1. Memory is Always Local

Memory constraints are never shared across instances via Redis. Each instance independently:
- Detects its available memory
- Calculates memory-based slots
- Applies the minimum with distributed allocation

### 2. Ratios Apply to Memory Too

The job type ratio determines what portion of instance memory each job type can use:

```
jobTypeA ratio = 0.7  → Gets 70% of instance memory
jobTypeB ratio = 0.3  → Gets 30% of instance memory
```

### 3. The Minimum Always Wins

A job type's final slot count is constrained by the **most restrictive** limit:

```
finalSlots = min(
  TPM-based slots,
  TPD-based slots,
  RPM-based slots,
  RPD-based slots,
  Concurrent slots,
  Memory-based slots   ← Local constraint
)
```

### 4. minCapacity and maxCapacity Are Per-Model Slot Bounds

These bounds are defined **per model** in `ModelRateLimitConfig` and applied **after** memory constraint:

```
For each jobType:
  1. distributedTotal = sum of slots across all models
  2. memorySlots = floor((totalMemory × ratio) / estimatedMemoryKB)
  3. constrainedTotal = min(distributedTotal, memorySlots)
  4. scaleFactor = constrainedTotal / distributedTotal

  For each model:
    scaledSlots = floor(distributedSlots × scaleFactor)
    finalSlots = clamp(scaledSlots, model.minCapacity, model.maxCapacity)
```

- `minCapacity`: Ensures at least N slots per model per job type (can **override** memory constraint)
- `maxCapacity`: Caps at N slots per model per job type

Example with `model-alpha: { minCapacity: 2, maxCapacity: 8 }` and memory constraint reducing slots by 50%:

| Job Type | Distributed | After Memory (×0.5) | After Clamp |
|----------|-------------|---------------------|-------------|
| jobTypeA | 0 | 0 | 2 (min override) |
| jobTypeB | 6 | 3 | 3 (within bounds) |
| jobTypeC | 20 | 10 | 8 (max applied) |

## E2E Testing Memory Constraints

To test memory-based slot calculation:

### 1. Start Instances with Constrained Memory

```bash
NODE_OPTIONS='--max-old-space-size=128' npm run e2e:instance1
```

### 2. Configure Job Types with Memory Estimates

```typescript
const memoryTestConfig = {
  models: {
    'test-model': {
      tokensPerMinute: 10000000, // High TPM (won't be limiting)
      pricing: { input: 1, cached: 0.1, output: 2 },
    },
  },
  resourceEstimations: {
    heavyJob: {
      estimatedUsedTokens: 1000,
      estimatedUsedMemoryKB: 10240, // 10MB per job
      ratio: { initialValue: 0.5 },
    },
    lightJob: {
      estimatedUsedTokens: 1000,
      estimatedUsedMemoryKB: 1024, // 1MB per job
      ratio: { initialValue: 0.5 },
    },
  },
};
```

### 3. Verify Memory is the Limiting Factor

Query the allocation endpoint and verify that:
- Heavy jobs have fewer slots (limited by memory)
- Light jobs have more slots (limited by TPM, not memory)

## Summary

| Aspect | Distributed (TPM/RPM/etc.) | Local (Memory) |
|--------|---------------------------|----------------|
| Coordinated via Redis | Yes | No |
| Divided by instanceCount | Yes | No |
| Applies ratio | Yes | Yes |
| Affects final slots | Yes (via min) | Yes (via min) |
| Constrained by | Model limits | Instance heap |
