# LLM Rate Limiter

A production-ready, TypeScript-first rate limiter for LLM APIs with multi-model support, automatic fallback, cost tracking, and distributed coordination.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Multi-Model Support** - Define independent rate limits per model with automatic fallback
- **Comprehensive Rate Limiting** - RPM, RPD, TPM, TPD, concurrent requests, and memory limits
- **Automatic Fallback** - Seamlessly switch to the next available model when one is exhausted
- **Cost Tracking** - Built-in pricing calculation per model with detailed usage reports
- **Distributed Coordination** - Redis backend for fair slot distribution across instances
- **Type-Safe** - Full TypeScript support with compile-time validation
- **Memory-Aware** - Optional memory-based capacity limits with automatic adjustment
- **Real-Time Availability** - Callbacks for availability changes with detailed reasons

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
      pricing: { input: 0.03, output: 0.06, cached: 0.015 }, // USD per million tokens
    },
  },
});

// Queue a job
const result = await limiter.queueJob({
  jobId: 'my-job-1',
  job: async ({ modelId }, reject) => {
    try {
      const response = await callOpenAI(modelId, 'Hello, world!');
      // Return JobResult with usage info and data
      return {
        requestCount: 1,
        inputTokens: 10,
        cachedTokens: 0,
        outputTokens: 20,
        data: { success: true, response },
      };
    } catch (error) {
      // Report actual usage before failing
      reject({ requestCount: 1, inputTokens: 10, cachedTokens: 0, outputTokens: 0 });
      throw error;
    }
  },
  onComplete: (result, { totalCost, usage }) => {
    console.log(`Job completed using ${result.modelUsed}, cost: $${totalCost}`);
  },
});
```

### Multi-Model with Fallback

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
  order: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet'], // Priority order
});

// Job automatically falls back to next model if current one is exhausted
const result = await limiter.queueJob({
  jobId: 'my-job',
  job: async ({ modelId }, reject) => {
    try {
      const response = await callLLM(modelId, prompt);
      // Return JobResult with usage info and data
      return {
        requestCount: 1,
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 50,
        data: response,
      };
    } catch (error) {
      // Delegate to next model on failure (delegate: true is default)
      reject({ requestCount: 1, inputTokens: 100, cachedTokens: 0, outputTokens: 0 }, { delegate: true });
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
    │   (gpt-4)       │   ───►   │ (gpt-3.5-turbo) │   ───►   │ (claude-3)      │
    │   Limiter       │ fallback │    Limiter      │ fallback │   Limiter       │
    └─────────────────┘          └─────────────────┘          └─────────────────┘
              │                            │                            │
              └────────────────────────────┼────────────────────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
    │  RPM / RPD      │          │  TPM / TPD      │          │  Concurrency    │
    │  Limiters       │          │  Limiters       │          │  Limiter        │
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

| Limit                     | Description             | Reset             |
| ------------------------- | ----------------------- | ----------------- |
| `requestsPerMinute` (RPM) | Max requests per minute | Every minute      |
| `requestsPerDay` (RPD)    | Max requests per day    | Every 24 hours    |
| `tokensPerMinute` (TPM)   | Max tokens per minute   | Every minute      |
| `tokensPerDay` (TPD)      | Max tokens per day      | Every 24 hours    |
| `maxConcurrentRequests`   | Max parallel requests   | On job completion |
| `memory`                  | Memory-based capacity   | Dynamic           |

## Distributed Rate Limiting with Redis

For multi-instance deployments, use the Redis backend for coordinated rate limiting with fair slot distribution.

### Setup

```typescript
import { createLLMRateLimiter } from '@llm-rate-limiter/core';
import { createRedisBackend } from '@llm-rate-limiter/redis';

// Create rate limiter with Redis backend
const limiter = createLLMRateLimiter({
  backend: createRedisBackend('YOUR_REDIS_CONNECTION_STR'),
  models: {
    'gpt-4': {
      requestsPerMinute: 500,
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

### How It Works

1. **Registration** - Each instance registers with Redis and receives a fair share of slots
2. **Fair Distribution** - Slots are distributed evenly across active instances
3. **Heartbeat** - Instances send periodic heartbeats; stale instances are cleaned up
4. **Reallocation** - When instances join/leave, slots are automatically redistributed
5. **Pub/Sub** - Allocation changes are broadcast to all instances in real-time

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Redis                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  Instances   │  │ Allocations  │  │   Pub/Sub    │                   │
│  │    Hash      │  │    Hash      │  │   Channel    │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘
         ▲                   ▲                   │
         │                   │                   │
    ┌────┴────┐         ┌────┴────┐         ┌────▼────┐
    │Register │         │ Acquire │         │Subscribe│
    │Heartbeat│         │ Release │         │ Updates │
    └────┬────┘         └────┬────┘         └────┬────┘
         │                   │                   │
    ┌────▼───────────────────▼───────────────────▼────┐
    │                   Instance A                     │
    │            LLM Rate Limiter (33 slots)          │
    └─────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────┐
    │                   Instance B                     │
    │            LLM Rate Limiter (33 slots)          │
    └─────────────────────────────────────────────────┘
    ┌─────────────────────────────────────────────────┐
    │                   Instance C                     │
    │            LLM Rate Limiter (34 slots)          │
    └─────────────────────────────────────────────────┘
```

### Redis Backend Options

```typescript
interface RedisBackendConfig {
  redis: Redis | RedisConnectionOptions;  // ioredis client or connection options
  totalCapacity: number;                  // Total slots across all instances
  tokensPerMinute?: number;               // Total TPM (optional)
  requestsPerMinute?: number;             // Total RPM (optional)
  keyPrefix?: string;                     // Redis key prefix (default: 'llm-rl:')
  heartbeatIntervalMs?: number;           // Heartbeat interval (default: 5000)
  instanceTimeoutMs?: number;             // Stale instance timeout (default: 15000)
}
```

### Monitoring

```typescript
const stats = await redisBackend.getStats();
console.log(stats);
// {
//   totalInstances: 3,
//   totalInFlight: 45,
//   totalAllocated: 100,
//   instances: [
//     { id: 'instance-1', inFlight: 20, allocation: 33, lastHeartbeat: 1706520000000 },
//     { id: 'instance-2', inFlight: 15, allocation: 33, lastHeartbeat: 1706520000100 },
//     { id: 'instance-3', inFlight: 10, allocation: 34, lastHeartbeat: 1706520000200 },
//   ]
// }
```

## API Reference

### `createLLMRateLimiter(config)`

Creates a new rate limiter instance.

```typescript
interface LLMRateLimiterConfig {
  models: Record<string, ModelRateLimitConfig>;  // Model configurations
  order?: string[];                              // Priority order (required if >1 model)
  memory?: MemoryLimitConfig;                    // Memory-based limits
  minCapacity?: number;                          // Minimum capacity floor
  maxCapacity?: number;                          // Maximum capacity ceiling
  label?: string;                                // Label for logging
  onLog?: LogFn;                                 // Logging callback
  onAvailableSlotsChange?: OnAvailableSlotsChange; // Availability change callback
  backend?: BackendConfig | DistributedBackendConfig; // Distributed backend
}

interface ModelRateLimitConfig {
  requestsPerMinute?: number;       // Max requests per minute
  requestsPerDay?: number;          // Max requests per day
  tokensPerMinute?: number;         // Max tokens per minute
  tokensPerDay?: number;            // Max tokens per day
  maxConcurrentRequests?: number;   // Max concurrent requests
  pricing: ModelPricing;            // Required for cost calculation
}

interface ModelPricing {
  input: number;   // USD per million input tokens
  cached: number;  // USD per million cached tokens
  output: number;  // USD per million output tokens
}
```

### `limiter.queueJob(options)`

Queue a job with automatic model selection and delegation support.

```typescript
const result = await limiter.queueJob({
  jobId: 'unique-job-id',
  job: async ({ modelId }, resolve, reject) => {
    // Your LLM API call here
    // Call resolve() on success with token usage
    // Call reject() on failure with token usage and optional { delegate: true }
  },
  args: { prompt: 'Hello' },  // Optional: custom args passed to job
  onComplete: (result, context) => { /* success callback */ },
  onError: (error, context) => { /* error callback */ },
});
```

### `limiter.hasCapacity()` / `limiter.hasCapacityForModel(modelId)`

Check if capacity is available (non-blocking).

```typescript
if (limiter.hasCapacity()) {
  // At least one model has capacity
}

if (limiter.hasCapacityForModel('gpt-4')) {
  // Specific model has capacity
}
```

### `limiter.getStats()` / `limiter.getModelStats(modelId)`

Get current statistics.

```typescript
const stats = limiter.getStats();
// {
//   models: {
//     'gpt-4': { availableSlots: 5, inFlight: 10, ... },
//     'gpt-3.5': { availableSlots: 100, inFlight: 0, ... }
//   },
//   memory: { activeKB: 500, maxCapacityKB: 1000, ... }
// }
```

### `limiter.start()` / `limiter.stop()`

Start/stop the limiter. Required for distributed backends.

```typescript
await limiter.start();  // Register with distributed backend
// ... use limiter ...
limiter.stop();         // Unregister and cleanup
```

## Availability Callbacks

Monitor real-time availability changes:

```typescript
const limiter = createLLMRateLimiter({
  models: { /* ... */ },
  onAvailableSlotsChange: (availability, reason, adjustment) => {
    console.log(`Slots available: ${availability.slots}`);
    console.log(`Reason: ${reason}`);
    // reason: 'adjustment' | 'tokensMinute' | 'tokensDay' | 'requestsMinute' |
    //         'requestsDay' | 'concurrentRequests' | 'memory' | 'distributed'

    if (adjustment) {
      // Adjustment shows difference between reserved and actual usage
      console.log(`Token adjustment: ${adjustment.tokensPerMinute}`);
    }
  },
});
```

## Memory-Based Limits

Automatically adjust capacity based on available system memory:

```typescript
const limiter = createLLMRateLimiter({
  models: {
    'gpt-4': {
      requestsPerMinute: 500,
      resourcesPerEvent: { estimatedUsedMemoryKB: 1000 }, // Memory per job
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
# Build all packages
npm run build

# Run all tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint

# Lint with auto-fix
npm run lint:fix

# Run specific package tests
npm run test:core
npm run test:redis
```

### Project Structure

```
llm-rate-limiter/
├── packages/
│   ├── core/                    # Core rate limiter library
│   │   ├── src/
│   │   │   ├── index.ts         # Public exports
│   │   │   ├── multiModelRateLimiter.ts  # Main implementation
│   │   │   ├── multiModelTypes.ts        # Type definitions
│   │   │   └── utils/           # Utilities (semaphore, memory, counters)
│   │   └── __tests__/           # Test suites (500+ tests)
│   │
│   └── redis/                   # Redis distributed backend
│       ├── src/
│       │   ├── index.ts         # Public exports
│       │   ├── redisBackend.ts  # Redis implementation
│       │   ├── luaScripts.ts    # Atomic Lua scripts for fair distribution
│       │   └── types.ts         # Type definitions
│       └── __tests__/           # Integration tests
│
├── package.json                 # Monorepo root
├── eslint.config.mjs           # ESLint configuration
├── tsconfig.json               # TypeScript configuration
└── README.md
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Write tests** for your changes (we aim for 100% coverage)
4. **Ensure** all tests pass (`npm test`)
5. **Ensure** lint passes (`npm run lint`)
6. **Ensure** types check (`npm run typecheck`)
7. **Commit** your changes with a clear message
8. **Push** to the branch (`git push origin feature/amazing-feature`)
9. **Open** a Pull Request

### Code Style

- TypeScript strict mode enabled
- No `any` types - use proper explicit types
- No ESLint disable comments
- Clear, descriptive variable and function names
- JSDoc comments for public APIs

### Running Tests

```bash
# All tests
npm test

# With coverage
npm test -- --coverage

# Specific test file
npm test -- path/to/test.ts

# Watch mode
npm test -- --watch
```

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with TypeScript. Tested with Jest. Distributed coordination powered by Redis.
