<p align="center">
  <h1 align="center">LLM Rate Limiter</h1>
  <p align="center">
    A production-ready, TypeScript-first rate limiter for LLM APIs with multi-model support, automatic fallback, cost tracking, and distributed coordination.
  </p>
</p>

<p align="center">
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License: MIT">
  </a>
  <a href="https://redis.io/">
    <img src="https://img.shields.io/badge/Redis-Optional-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#installation">Installation</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#distributed-mode">Distributed Mode</a> &bull;
  <a href="#api-reference">API Reference</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

## Why LLM Rate Limiter?

LLM APIs have complex rate limiting rules: requests per minute, tokens per minute, concurrent request limits, and daily quotas. When you're running multiple models across multiple instances, managing these limits becomes a significant engineering challenge.

**LLM Rate Limiter** solves this by providing:

- **Unified Rate Limiting** - One library to handle RPM, TPM, RPD, TPD, concurrency, and memory limits
- **Smart Fallback** - Automatically switch to the next available model when one is exhausted
- **Distributed Coordination** - Fair slot distribution across multiple instances via Redis
- **Accurate Cost Tracking** - Built-in pricing calculation with per-request cost breakdowns
- **Actual Usage Adjustment** - Refund unused capacity when jobs use less than estimated

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Model Support** | Define independent rate limits per model with configurable priority order |
| **Automatic Fallback** | Seamlessly delegate to the next available model when capacity is exhausted |
| **Comprehensive Limits** | RPM, RPD, TPM, TPD, concurrent requests, and memory-based limits |
| **Cost Tracking** | Built-in pricing calculation with input/output/cached token rates |
| **Distributed Coordination** | Redis backend for fair slot distribution across instances |
| **Type-Safe** | Full TypeScript support with compile-time validation |
| **Memory-Aware** | Optional memory-based capacity limits with automatic adjustment |
| **Queue Management** | Configurable wait times with automatic capacity-based queuing |
| **Actual Usage Adjustment** | Refund or charge based on actual vs estimated token usage |
| **Dynamic Ratios** | Local job type ratio adjustment based on load patterns |

## Installation

```bash
# Core library
npm install @llm-rate-limiter/core

# Redis backend (optional, for distributed systems)
npm install @llm-rate-limiter/redis
```

## Quick Start

### Single Model

```typescript
import { createLLMRateLimiter } from '@llm-rate-limiter/core';

const limiter = createLLMRateLimiter({
  models: {
    'gpt-4': {
      requestsPerMinute: 500,
      tokensPerMinute: 100000,
      maxConcurrentRequests: 10,
      pricing: { input: 0.03, output: 0.06, cached: 0.015 },
    },
  },
});

const result = await limiter.queueJob({
  jobId: 'my-job-1',
  job: async ({ modelId }, reject) => {
    const response = await callOpenAI(modelId, 'Hello, world!');
    return {
      requestCount: 1,
      inputTokens: 10,
      cachedTokens: 0,
      outputTokens: 20,
      data: response,
    };
  },
  onComplete: (result, { totalCost }) => {
    console.log(`Completed with ${result.modelUsed}, cost: $${totalCost}`);
  },
});
```

### Multi-Model with Automatic Fallback

```typescript
const limiter = createLLMRateLimiter({
  models: {
    'gpt-4': {
      requestsPerMinute: 100,
      pricing: { input: 0.03, output: 0.06, cached: 0.015 },
    },
    'gpt-3.5-turbo': {
      requestsPerMinute: 1000,
      pricing: { input: 0.001, output: 0.002, cached: 0.0005 },
    },
    'claude-3-sonnet': {
      requestsPerMinute: 500,
      pricing: { input: 0.003, output: 0.015, cached: 0.00075 },
    },
  },
  order: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet'],
});

const result = await limiter.queueJob({
  jobId: 'my-job',
  job: async ({ modelId }, reject) => {
    try {
      const response = await callLLM(modelId, prompt);
      return {
        requestCount: 1,
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50,
        data: response,
      };
    } catch (error) {
      // Delegate to next model on failure
      reject(
        { requestCount: 1, inputTokens: 100, cachedTokens: 0, outputTokens: 0 },
        { delegate: true }
      );
      throw error;
    }
  },
});

console.log(`Used model: ${result.modelUsed}`);
```

## Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │           LLM Rate Limiter                  │
                        └─────────────────────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
    │    Model A      │          │    Model B      │          │    Model C      │
    │   (primary)     │   ───►   │   (fallback)    │   ───►   │   (fallback)    │
    │   Limiter       │ delegate │    Limiter      │ delegate │   Limiter       │
    └─────────────────┘          └─────────────────┘          └─────────────────┘
              │                            │                            │
              └────────────────────────────┼────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
    │  RPM / RPD      │          │  TPM / TPD      │          │  Concurrency    │
    │  Limiters       │          │  Limiters       │          │  + Memory       │
    └─────────────────┘          └─────────────────┘          └─────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        │        Backend (optional)           │
                        │  ┌─────────┐    ┌────────────────┐  │
                        │  │  Local  │ OR │ Redis (dist.)  │  │
                        │  └─────────┘    └────────────────┘  │
                        └─────────────────────────────────────┘
```

### Rate Limit Types

| Limit | Description | Reset |
|-------|-------------|-------|
| `requestsPerMinute` (RPM) | Max requests per minute | Every minute |
| `requestsPerDay` (RPD) | Max requests per day | Every 24 hours |
| `tokensPerMinute` (TPM) | Max tokens per minute | Every minute |
| `tokensPerDay` (TPD) | Max tokens per day | Every 24 hours |
| `maxConcurrentRequests` | Max parallel requests | On job completion |
| `memory` | Memory-based capacity | Dynamic |

## Distributed Mode

For multi-instance deployments, use the Redis backend for coordinated rate limiting with fair slot distribution.

### How It Works

The distributed system uses a **pool-based allocation** approach:

1. **Redis** tracks global capacity per model and divides it fairly across instances
2. **Local instances** distribute their allocated pool across job types using configurable ratios
3. **Actual usage** is reported back to Redis, which adjusts allocations dynamically

```
┌─────────────────────────────────────────────────────────────────────┐
│                              Redis                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Instances   │  │ Pool Alloc.  │  │ Global Usage │               │
│  │    Hash      │  │    Hash      │  │   Counters   │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
         ▲                   ▲                   │
         │                   │                   ▼
    ┌────┴───────────────────┴───────────────────┴────┐
    │                   Instance A                     │
    │   Pool: 33 slots  │  Local Ratios: jobA=0.6     │
    │                   │               jobB=0.4      │
    └─────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────┐
    │                   Instance B                     │
    │   Pool: 33 slots  │  Local Ratios: jobA=0.5     │
    │                   │               jobB=0.5      │
    └─────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────┐
    │                   Instance C                     │
    │   Pool: 34 slots  │  Local Ratios: jobA=0.7     │
    │                   │               jobB=0.3      │
    └─────────────────────────────────────────────────┘
```

### Setup

```typescript
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

const limiter = createLLMRateLimiter({
  backend: createRedisBackend({
    redis: 'redis://localhost:6379',
    keyPrefix: 'llm-rl:',
  }),
  models: {
    'gpt-4': {
      requestsPerMinute: 500,
      tokensPerMinute: 1000000,
      pricing: { input: 0.03, output: 0.06, cached: 0.015 },
    },
  },
});

// Start (registers with Redis for slot allocation)
await limiter.start();

// Use normally...
const result = await limiter.queueJob({ /* ... */ });

// Stop (unregisters from Redis)
await limiter.stop();
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Fair Division** | Slots distributed evenly across active instances |
| **Heartbeat** | Automatic cleanup of stale instances |
| **Pub/Sub** | Real-time allocation updates via Redis channels |
| **Actual Usage Tracking** | Global counters adjust allocations based on real consumption |
| **Local Ratio Management** | Each instance optimizes job type distribution independently |

### Monitoring

```typescript
const stats = await redisBackend.getStats();
// {
//   totalInstances: 3,
//   totalInFlight: 45,
//   totalAllocated: 100,
//   instances: [
//     { id: 'instance-1', inFlight: 20, allocation: 33, lastHeartbeat: ... },
//     { id: 'instance-2', inFlight: 15, allocation: 33, lastHeartbeat: ... },
//     { id: 'instance-3', inFlight: 10, allocation: 34, lastHeartbeat: ... },
//   ]
// }
```

## Advanced Features

### Queue Management with maxWaitMS

Control how long jobs wait for capacity before delegating to the next model:

```typescript
const limiter = createLLMRateLimiter({
  models: {
    'gpt-4': { tokensPerMinute: 100000, pricing: { ... } },
    'gpt-3.5': { maxConcurrentRequests: 10, pricing: { ... } },
  },
  resourceEstimationsPerJob: {
    // Critical jobs: wait for capacity (dynamic default: 5-65s)
    critical: {
      estimatedUsedTokens: 500,
      // maxWaitMS not specified → uses dynamic default
    },
    // Low priority: fail fast, delegate immediately
    lowPriority: {
      estimatedUsedTokens: 100,
      maxWaitMS: {
        'gpt-4': 0,      // Don't wait
        'gpt-3.5': 0,    // Don't wait
      },
    },
    // Mixed: different wait times per model
    standard: {
      estimatedUsedTokens: 200,
      maxWaitMS: {
        'gpt-4': 60000,   // Wait up to 60s (TPM resets predictably)
        'gpt-3.5': 5000,  // Wait only 5s (concurrent limit is unpredictable)
      },
    },
  },
});
```

### Memory-Based Limits

Automatically adjust capacity based on available system memory:

```typescript
const limiter = createLLMRateLimiter({
  models: {
    'gpt-4': {
      requestsPerMinute: 500,
      resourcesPerEvent: { estimatedUsedMemoryKB: 1000 },
      pricing: { input: 0.03, output: 0.06, cached: 0.015 },
    },
  },
  memory: {
    freeMemoryRatio: 0.5,           // Use up to 50% of free memory
    recalculationIntervalMs: 5000,  // Recalculate every 5 seconds
  },
  minCapacity: 10,   // Never go below 10 concurrent jobs
  maxCapacity: 100,  // Never exceed 100 concurrent jobs
});
```

### Availability Callbacks

Monitor real-time availability changes:

```typescript
const limiter = createLLMRateLimiter({
  models: { /* ... */ },
  onAvailableSlotsChange: (availability, reason, adjustment) => {
    console.log(`Slots: ${availability.slots}, Reason: ${reason}`);
    // reason: 'adjustment' | 'tokensMinute' | 'tokensDay' |
    //         'requestsMinute' | 'requestsDay' | 'concurrentRequests' |
    //         'memory' | 'distributed'
  },
});
```

### Job Type Ratios

Configure how capacity is distributed across different job types:

```typescript
const limiter = createLLMRateLimiter({
  models: { /* ... */ },
  resourceEstimationsPerJob: {
    summary: {
      estimatedUsedTokens: 10000,
      ratio: { initialValue: 0.4, flexible: false },  // Fixed 40%, protected
    },
    chat: {
      estimatedUsedTokens: 2000,
      ratio: { initialValue: 0.3 },  // Flexible, can adjust based on load
    },
    background: {
      estimatedUsedTokens: 5000,
      ratio: { initialValue: 0.3 },  // Flexible
    },
  },
});
```

## API Reference

### `createLLMRateLimiter(config)`

Creates a new rate limiter instance.

```typescript
interface LLMRateLimiterConfig {
  models: Record<string, ModelRateLimitConfig>;
  order?: string[];                              // Priority order (required if >1 model)
  memory?: MemoryLimitConfig;
  minCapacity?: number;
  maxCapacity?: number;
  resourceEstimationsPerJob?: Record<string, JobTypeConfig>;
  backend?: BackendConfig | DistributedBackendConfig;
  label?: string;
  onLog?: LogFn;
  onAvailableSlotsChange?: OnAvailableSlotsChange;
}

interface ModelRateLimitConfig {
  requestsPerMinute?: number;
  requestsPerDay?: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
  maxConcurrentRequests?: number;
  pricing: { input: number; cached: number; output: number };
}
```

### `limiter.queueJob(options)`

Queue a job with automatic model selection.

```typescript
const result = await limiter.queueJob({
  jobId: 'unique-job-id',
  jobType: 'summary',  // Optional: uses configured estimations
  job: async ({ modelId }, reject) => {
    // Your LLM API call
    return { requestCount, inputTokens, cachedTokens, outputTokens, data };
  },
  onComplete: (result, context) => { /* success */ },
  onError: (error, context) => { /* failure */ },
});
```

### `limiter.hasCapacity()` / `limiter.hasCapacityForModel(modelId)`

Check capacity availability (non-blocking).

### `limiter.getStats()` / `limiter.getModelStats(modelId)`

Get current statistics and usage information.

### `limiter.start()` / `limiter.stop()`

Start/stop the limiter. Required for distributed backends.

## Project Structure

```
llm-rate-limiter/
├── packages/
│   ├── core/                    # Core rate limiter library
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── multiModelRateLimiter.ts
│   │   │   ├── multiModelTypes.ts
│   │   │   └── utils/
│   │   └── __tests__/
│   │
│   ├── redis/                   # Redis distributed backend
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── redisBackend.ts
│   │   │   └── luaScripts.ts
│   │   └── __tests__/
│   │
│   └── e2e/                     # End-to-end test infrastructure
│       ├── serverInstance/
│       ├── proxy/
│       └── testRunner/
│
├── docs/                        # Design documents
├── package.json
└── README.md
```

## Development

### Prerequisites

- Node.js 18+
- npm 9+
- Redis (for distributed backend tests)

### Setup

```bash
git clone https://github.com/user/llm-rate-limiter.git
cd llm-rate-limiter
npm install
```

### Commands

```bash
npm run build          # Build all packages
npm test               # Run all tests
npm run typecheck      # Type check
npm run lint           # Lint
npm run lint:fix       # Lint with auto-fix

# Package-specific
npm run test:core      # Core package tests
npm run test:redis     # Redis package tests

# E2E testing
npm run e2e:setup      # Start test instances
npm run e2e:test       # Run E2E tests
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Write tests** for your changes
4. **Ensure** all tests pass (`npm test`)
5. **Ensure** lint passes (`npm run lint`)
6. **Ensure** types check (`npm run typecheck`)
7. **Commit** your changes with a clear message
8. **Push** to the branch
9. **Open** a Pull Request

### Code Style

- TypeScript strict mode enabled
- No `any` types - use proper explicit types
- No ESLint disable comments
- Clear, descriptive variable and function names

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with TypeScript &bull; Tested with Jest &bull; Distributed coordination powered by Redis
</p>
