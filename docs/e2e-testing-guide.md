# E2E Testing Framework Guide

This guide explains how the e2e testing framework works for the distributed rate limiter, including architecture, how to run tests, and how to write new tests.

## System Architecture

The distributed rate limiter implements a **pool-based** slot allocation system:

- **Redis** calculates per-model pools using **averaged estimates** across all job types:
  `pools[model].totalSlots = floor(modelCapacity / avgEstimatedResource / instanceCount)`
- **Local instances** distribute pool slots across job types using ratios

This separation allows dynamic ratio adjustments without Redis round-trips.

**Important:** Redis uses the **average** of all job type estimates (not per-job-type calculation). This simplifies Redis logic while local instances handle the per-job-type distribution via ratios.

```
┌─────────────────────────────────────────────────────────────────┐
│                            REDIS                                 │
│                                                                  │
│  Tracks per-model pools only (no job type awareness):           │
│  pools['model-alpha'] = { totalSlots: 10, tokensPerMinute: 50K } │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │Instance A│    │Instance B│    │Instance C│
        │          │    │          │    │          │
        │ Local    │    │ Local    │    │ Local    │
        │ JobType  │    │ JobType  │    │ JobType  │
        │ Manager  │    │ Manager  │    │ Manager  │
        │          │    │          │    │          │
        │ Ratios:  │    │ Ratios:  │    │ Ratios:  │
        │ A: 0.6   │    │ A: 0.5   │    │ A: 0.7   │
        │ B: 0.4   │    │ B: 0.5   │    │ B: 0.3   │
        └──────────┘    └──────────┘    └──────────┘
```

Each instance can have different local ratios (due to different load patterns), but they all share the same per-model pool allocation from Redis.

---

## Running Tests

### Prerequisites

A Redis instance must be running on `localhost:6379` before executing the tests.

### Self-Contained Tests

All e2e tests are self-contained: they boot their own instances and proxy programmatically, requiring only Redis to be running beforehand. Each test:
1. Cleans Redis before starting
2. Boots fresh server instances with the appropriate config preset
3. Boots the proxy (if needed)
4. Runs the test scenarios
5. Tears down all infrastructure after completion

This design ensures:
- Tests are isolated and don't interfere with each other
- Tests can be run in any order
- CI/CD environments can run tests without manual setup
- Tests can control instance count dynamically for scaling scenarios

### Execute Tests

Ensure Redis is running on `localhost:6379`, then run the tests:

```bash
# Run all e2e tests
npm run test:e2e

# Run a specific test
npm run test:e2e:single -- --testPathPatterns=exactCapacity.test

# Run tests by category
npm run test:e2e:single -- --testPathPatterns=slotCalculation.test
npm run test:e2e:single -- --testPathPatterns=instanceScaling.test

# Verify infrastructure setup works
npm run test:e2e:verifySetup
```

### Recommended Execution Order

For debugging, run tests in order of complexity:

1. `slotCalculation` - Validates basic pool math
2. `fixedRatioIsolation` - Validates ratio protection
3. `slotsEvolveWithLoad` - Validates temporal behavior
4. `instanceScaling` - Validates instance dynamics
5. `flexibleRatioAdjustment` - Validates local ratio algorithm
6. `localRatioOnly` - Validates cross-instance isolation

---

## Writing Tests

### Infrastructure Lifecycle Functions

```typescript
import { bootInstance, killInstance, killAllInstances, cleanRedis } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
```

| Function | Description |
|----------|-------------|
| `bootInstance(port, configPreset)` | Boot a server instance on the specified port with a config preset |
| `killInstance(port)` | Kill a specific instance by port |
| `killAllInstances()` | Kill all managed instances |
| `bootProxy(targetPorts, port?)` | Boot the proxy, routing to the specified target ports |
| `killProxy()` | Kill the proxy |
| `cleanRedis()` | Delete all rate limiter keys from Redis |

### Shared Infrastructure Helpers

For tests that need standard 2-instance + proxy setup, use the shared helpers:

```typescript
import {
  bootInfrastructure,
  teardownInfrastructure,
  PROXY_URL,
  INSTANCE_URLS,
} from './infrastructureHelpers.js';

beforeAll(async () => {
  await bootInfrastructure('default'); // or pass a specific config preset
}, 60000);

afterAll(async () => {
  await teardownInfrastructure();
}, 30000);
```

### Example: Basic Test Structure

```typescript
import { bootInstance, cleanRedis, killAllInstances } from '../instanceLifecycle.js';
import { bootProxy, killProxy } from '../proxyLifecycle.js';
import { generateJobsOfType, runSuite } from '../suiteRunner.js';

const PROXY_PORT = 3000;
const INSTANCE_PORT_1 = 3001;
const INSTANCE_PORT_2 = 3002;

/** Boot all infrastructure components */
const bootInfrastructure = async (): Promise<void> => {
  await cleanRedis();
  await bootInstance(INSTANCE_PORT_1, 'default');
  await bootInstance(INSTANCE_PORT_2, 'default');
  await bootProxy([INSTANCE_PORT_1, INSTANCE_PORT_2], PROXY_PORT);
};

/** Tear down all infrastructure components */
const teardownInfrastructure = async (): Promise<void> => {
  try { await killProxy(); } catch { /* may not have started */ }
  try { await killAllInstances(); } catch { /* may not have started */ }
};

describe('My Test', () => {
  beforeAll(async () => {
    await bootInfrastructure();
  }, 60000);

  afterAll(async () => {
    await teardownInfrastructure();
  }, 30000);

  it('should work', () => {
    // ... assertions
  });
});
```

### Example: Dynamic Instance Scaling Test

```typescript
import { bootInstance, killInstance, cleanRedis, fetchAllocation } from '../instanceLifecycle.js';

describe('Instance Scaling', () => {
  beforeAll(async () => {
    await cleanRedis();
  });

  afterAll(async () => {
    await killAllInstances();
  });

  it('should halve slots when second instance joins', async () => {
    // Start with one instance
    await bootInstance(3001, 'instanceScaling');
    let allocation = await fetchAllocation(3001);
    expect(allocation.allocation?.instanceCount).toBe(1);
    const initialSlots = allocation.allocation?.pools['scale-model']?.totalSlots;

    // Add second instance
    await bootInstance(3002, 'instanceScaling');
    allocation = await fetchAllocation(3001);
    expect(allocation.allocation?.instanceCount).toBe(2);
    expect(allocation.allocation?.pools['scale-model']?.totalSlots).toBe(Math.floor(initialSlots / 2));

    // Remove second instance
    await killInstance(3002);
    // Wait for Redis to detect instance timeout...
  });
});
```

---

## Configuration Presets

Tests use different configuration presets defined in `packages/e2e/serverInstance/src/rateLimiterConfigs.ts`.

### Core Presets

| Preset | Use Case |
|--------|----------|
| `'default'` | Production-like config with 3 models and 5 job types |
| `'slotCalculation'` | Simple config for verifying slot math |
| `'fixedRatio'` | Testing fixed vs flexible job type behavior |
| `'flexibleRatio'` | Testing dynamic ratio adjustment |
| `'instanceScaling'` | Testing instance join/leave scenarios |

### Slot Calculation Presets

| Preset | Model Limits | Purpose |
|--------|--------------|---------|
| `'slotCalc-tpm'` | TPM only (100K) | TPM-based slot calculation |
| `'slotCalc-rpm'` | RPM only (500) | RPM-based slot calculation |
| `'slotCalc-tpd'` | TPD only (1M) | TPD-based slot calculation |
| `'slotCalc-rpd'` | RPD only (10K) | RPD-based slot calculation |
| `'slotCalc-concurrent'` | maxConcurrent only (100) | Concurrency-based calculation |
| `'slotCalc-tpm-rpm'` | TPM (100K) + RPM (50) | Mixed limits (limiting factor) |
| `'slotCalc-multi-model'` | Multiple models | Different limit types per model |
| `'slotCalc-memory'` | TPM (10M, very high) | Memory as local constraint |

See `packages/e2e/serverInstance/src/rateLimiterConfigs/` for all available presets.

---

## Pool Calculation Formula

Redis calculates pool slots using **averaged estimates** across all job types:

```
Step 1: Calculate average estimates across all job types
  avgEstimatedTokens = sum(jobType.estimatedTokens) / jobTypeCount
  avgEstimatedRequests = sum(jobType.estimatedRequests) / jobTypeCount

Step 2: Calculate per-limit-type slots using averages
  For TPM-limited models:
    pools[model].totalSlots = floor((TPM / avgEstimatedTokens) / instanceCount)
    pools[model].tokensPerMinute = TPM / instanceCount

  For RPM-limited models:
    pools[model].totalSlots = floor((RPM / avgEstimatedRequests) / instanceCount)
    pools[model].requestsPerMinute = RPM / instanceCount

  For concurrent-limited models:
    pools[model].totalSlots = floor(maxConcurrent / instanceCount)

  For mixed limits:
    pools[model].totalSlots = min(tpm_slots, rpm_slots, concurrent_slots, ...)
```

**Note:** Job type ratios are NOT part of Redis pool calculation. Ratios are applied locally by each instance's JobTypeManager.

---

## Data Structures

### AllocationInfo (from Redis)

```typescript
interface AllocationInfo {
  instanceCount: number;
  pools: {
    [modelId: string]: {
      totalSlots: number;
      tokensPerMinute: number;
      requestsPerMinute: number;
      tokensPerDay: number;
      requestsPerDay: number;
    };
  };
  dynamicLimits?: {
    [modelId: string]: {
      tokensPerMinute?: number;
      requestsPerMinute?: number;
      tokensPerDay?: number;
      requestsPerDay?: number;
    };
  };
}
```

### Local JobTypeManager State

Each instance maintains local state:

```typescript
interface JobTypeState {
  currentRatio: number;      // Can change based on local load
  initialRatio: number;      // From config
  flexible: boolean;         // Can donate/receive capacity
  inFlight: number;          // Current jobs running
  allocatedSlots: number;    // floor(poolSlots * currentRatio)
}
```

---

## Troubleshooting

### "All models rejected by backend"

This error indicates the backend has no available pool slots. Check:
1. Instance count matches expected (pool slots are divided by instance count)
2. Model has capacity configured (TPM, RPM, or maxConcurrent)
3. Job type is configured in `resourceEstimationsPerJob`

### Jobs timing out

Increase `waitTimeoutMs` in the test configuration. Some tests with long-running jobs need 60-90 seconds.

### Inconsistent slot counts

Ensure Redis is clean between test runs. The first instance reset should use `cleanRedis: true`.

### Ratio not adjusting

The ratio adjustment algorithm only runs:
- Periodically (based on `adjustmentIntervalMs`, default 5000ms)
- After N releases (based on `releasesPerAdjustment`, default 10)

Ensure the test runs long enough for adjustments to trigger.
