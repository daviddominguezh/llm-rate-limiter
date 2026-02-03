# maxWaitMS Feature Design

## Overview

The `maxWaitMS` parameter controls how long a job is willing to wait for capacity before delegating to the next model or rejecting.

## Breaking Change Notice

**This is the new default behavior.** There is no backward compatibility mode. All existing code will need to be aware that:

1. Jobs now wait for capacity by default (up to 65 seconds max)
2. To get fail-fast behavior, explicitly set `maxWaitMS: 0` for the desired models
3. The queue-based waiting system replaces the previous polling-based approach

## Problem Statement

Different models have different rate limit characteristics:
- **TPM/RPM limits** (e.g., gpt-5.2): Reset predictably at minute boundaries. Waiting makes sense because capacity will be available within 60 seconds.
- **Concurrent request limits** (e.g., gpt-oss-20b): Depend on job completion. Waiting is unpredictable because it depends on when running jobs finish.

Different job types have different priorities:
- **Low priority jobs**: Should fail fast and not block resources
- **Critical jobs**: Worth waiting for capacity

## Behavior

### Without capacity available:

```
Job arrives → No capacity
    │
    ├── maxWaitMS = 0 → Immediately delegate to next model or reject
    │
    └── maxWaitMS > 0 → Queue and wait
            │
            ├── Capacity available before timeout → Execute
            │
            └── Timeout expires → Delegate to next model or reject
```

### Default maxWaitMS calculation (when not specified):

When `maxWaitMS` is not explicitly configured, it defaults to the time remaining until the next minute boundary plus 5 seconds:

```typescript
const getDefaultMaxWaitMS = () => {
  const now = new Date();
  const secondsToNextMinute = 60 - now.getSeconds();
  return (secondsToNextMinute + 5) * 1000; // Results in 5,000ms to 65,000ms
};
```

**Rationale:**
- TPM/RPM limits reset at minute boundaries
- The 5-second buffer accounts for processing time and clock skew
- Maximum wait of 65 seconds ensures at least one full rate limit cycle

**Examples:**
| Job attempt time | Seconds to next minute | Default maxWaitMS |
|------------------|------------------------|-------------------|
| 22:10:00         | 60                     | 65,000ms          |
| 22:10:30         | 30                     | 35,000ms          |
| 22:10:55         | 5                      | 10,000ms          |
| 22:10:59         | 1                      | 6,000ms           |

## Configuration

`maxWaitMS` is configured **per job type, per model** in `resourceEstimationsPerJob`:

```typescript
createLLMRateLimiter({
  models: {
    'gpt-5.2': {
      tokensPerMinute: 100000,
      requestsPerMinute: 100,
    },
    'gpt-oss-20b': {
      maxConcurrentRequests: 10,
    },
  },
  resourceEstimationsPerJob: {
    // Low priority: explicitly no waiting for any model
    lowPriority: {
      estimatedUsedTokens: 100,
      maxWaitMS: {
        'gpt-5.2': 0,       // Don't wait
        'gpt-oss-20b': 0,   // Don't wait
      }
    },

    // Critical: use dynamic default for all models
    critical: {
      estimatedUsedTokens: 500,
      // maxWaitMS not specified → uses dynamic default (5-65s)
    },

    // Mixed: different wait times per model
    standard: {
      estimatedUsedTokens: 200,
      maxWaitMS: {
        'gpt-5.2': 60000,    // Wait up to 60s (TPM resets predictably)
        'gpt-oss-20b': 5000, // Wait only 5s (concurrent limit is unpredictable)
      }
    },

    // Partial specification: some explicit, some default
    background: {
      estimatedUsedTokens: 100,
      maxWaitMS: {
        'gpt-5.2': 30000,   // Explicit 30s
        // 'gpt-oss-20b' not specified → uses dynamic default
      }
    }
  }
});
```

## Configuration Reference

| `maxWaitMS` value | Behavior |
|-------------------|----------|
| Not specified (undefined) | Dynamic default: `(60 - currentSeconds + 5) * 1000` ms |
| `0` | Fail fast - immediately delegate or reject |
| `> 0` | Wait up to specified milliseconds |

## Queue Implementation

### Local mode (no distributed backend)

Jobs waiting for capacity are queued locally. When capacity becomes available (e.g., a job completes or a rate limit window resets), the next job in the queue is woken up.

```
┌─────────────────────────────────────────────────────┐
│ Local Rate Limiter                                  │
│                                                     │
│  ┌─────────────┐    ┌─────────────┐                │
│  │ RPM Counter │    │ TPM Counter │                │
│  └─────────────┘    └─────────────┘                │
│         │                  │                        │
│         └────────┬─────────┘                        │
│                  ▼                                  │
│         ┌───────────────┐                          │
│         │  Wait Queue   │ ◄── Jobs waiting         │
│         │  (per model)  │     for capacity         │
│         └───────────────┘                          │
│                  │                                  │
│                  ▼                                  │
│         Capacity available → Wake next job         │
└─────────────────────────────────────────────────────┘
```

### Distributed mode (with Redis backend)

The backend coordinates capacity across multiple instances. Each instance maintains a local queue, but capacity information comes from the backend.

```
┌─────────────────┐     ┌─────────────────┐
│   Instance A    │     │   Instance B    │
│                 │     │                 │
│  ┌───────────┐  │     │  ┌───────────┐  │
│  │ Local     │  │     │  │ Local     │  │
│  │ Queue     │  │     │  │ Queue     │  │
│  └───────────┘  │     │  └───────────┘  │
│        │        │     │        │        │
└────────┼────────┘     └────────┼────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │   Redis Backend     │
         │                     │
         │  - Global capacity  │
         │  - Allocation per   │
         │    instance         │
         │  - Subscription     │
         │    events           │
         └─────────────────────┘
```

**Coordination:**
1. Backend allocates capacity to each instance
2. When backend allocation changes, instances are notified via subscription
3. Local queues wake jobs based on allocated capacity
4. If local capacity is exhausted, jobs wait for backend reallocation or timeout

## Queue Wake-up Triggers

| Trigger | Description |
|---------|-------------|
| Job completes | Releases capacity, wakes next queued job |
| Rate limit window resets | TPM/RPM counters reset, wakes queued jobs |
| Backend allocation change | New capacity allocated, wakes queued jobs |
| Timeout expires | Job removed from queue, delegates or rejects |

## Error Handling

When a job times out waiting for capacity:

1. Remove job from wait queue
2. Try next model in escalation order (if available)
3. If no more models, reject with error

```typescript
// Rejection error
throw new Error('All models exhausted: no capacity available within maxWaitMS');

// Or via onError callback if provided
options.onError?.(new Error('...'), { jobId, usage, totalCost });
```

## Type Safety

Model IDs in `maxWaitMS` are type-checked at compile time. If you specify a model ID that doesn't exist in your `models` config, TypeScript will report an error.

```typescript
// Models are inferred from the config
const limiter = createLLMRateLimiter({
  models: {
    'gpt-5.2': { tokensPerMinute: 100000 },
    'gpt-oss-20b': { maxConcurrentRequests: 10 },
  },
  resourceEstimationsPerJob: {
    critical: {
      estimatedUsedTokens: 500,
      maxWaitMS: {
        'gpt-5.2': 60000,      // ✓ Valid - model exists
        'gpt-oss-20b': 5000,   // ✓ Valid - model exists
        'invalid-model': 0,    // ✗ Compile error! Model doesn't exist
      }
    },
  }
});
```

### Type Definition

```typescript
type MaxWaitMSConfig<ModelIds extends string> = {
  [K in ModelIds]?: number;
};

interface JobTypeConfig<ModelIds extends string> {
  estimatedUsedTokens?: number;
  estimatedUsedMemoryKB?: number;
  estimatedNumberOfRequests?: number;
  ratio?: { initialValue: number; flexible?: boolean };
  maxWaitMS?: MaxWaitMSConfig<ModelIds>;
}

interface LLMRateLimiterConfig<
  Models extends Record<string, ModelConfig>,
  JobTypes extends Record<string, JobTypeConfig<keyof Models & string>>
> {
  models: Models;
  resourceEstimationsPerJob?: JobTypes;
}
```

### Benefits

1. **Catch typos at compile time**: Misspelled model IDs are caught immediately
2. **Refactoring safety**: Renaming a model ID will highlight all places that need updating
3. **IDE autocomplete**: Your IDE will suggest valid model IDs when typing

## Design Decisions

1. **No override at queue time**: `maxWaitMS` is configured only at the job type/model level, not per individual job call. This keeps the API simple and encourages consistent behavior.

2. **Per model, per job type**: Different models have different limit characteristics, and different job types have different priorities. The configuration reflects this reality.

3. **Dynamic default**: The default calculation (time to next minute + 5s) is optimized for TPM/RPM limits which reset at minute boundaries.

4. **Queue-based waiting**: Uses efficient FIFO queues instead of polling, avoiding the "thundering herd" problem.

5. **No backward compatibility**: This is a breaking change. The new behavior is the only behavior. This keeps the codebase simple and avoids feature flags or compatibility modes.

6. **Compile-time type safety**: Model IDs in `maxWaitMS` are validated against the `models` config at compile time, preventing runtime errors from typos or misconfigurations.
