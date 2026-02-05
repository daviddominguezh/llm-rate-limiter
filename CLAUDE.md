# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# All-in-one check (format + lint + typecheck)
npm run check

# Individual checks
npm run format      # Prettier
npm run lint        # ESLint
npm run typecheck   # TypeScript

# Build
npm run build                # All packages
npm run build:core           # Core only
npm run build:redis          # Redis only

# Test
npm test                     # All packages
npm run test:core            # Core package
npm run test:redis           # Redis package (unit)
npm run test:redis-e2e       # Redis package (e2e)

# E2E distributed tests (requires Redis running)
npm run e2e:setup            # Start 2 instances + proxy (runs in background)
npm run e2e:test             # Run full test suite
npm run e2e:test:escalation  # Run specific test
```

## Architecture

**Monorepo** with three packages:
- `packages/core` - Core rate limiter (local/in-memory)
- `packages/redis` - Redis backend for distributed coordination
- `packages/e2e` - E2E test infrastructure (proxy, server instances, test runner)

**Layered Design**:
1. **Public API** (`LLMRateLimiter`) - Multi-model orchestration with fallback chains
2. **Internal Limiter** (`LLMRateLimiterInternal`) - Per-model rate limiting (RPM/TPM/RPD/TPD/concurrency)
3. **Backend Abstraction** - Pluggable local or Redis backends

### Key Architectural Concepts

**Pool-based allocation** (distributed mode):
- Redis calculates per-model pools using **averaged estimates** across all job types
- Formula: `pools[model].totalSlots = floor(modelCapacity / avgEstimatedResource / instanceCount)`
- Redis does NOT know about job types - only model-level capacity

**Local ratio management**:
- Each instance distributes its pool slots across job types using local ratios
- Ratios are NOT shared via Redis - each instance adjusts independently based on its load
- Flexible job types can donate/receive capacity; fixed job types are protected

**Time-window-aware adjustments**:
- Refunds only happen if job completes within the same time window it started
- Job starting in minute 10, finishing in minute 11 → no refund (window 10 already closed)
- Overages are always added to counters (accurate tracking)

**Memory is LOCAL**:
- Memory constraints are per-instance, not distributed via Redis
- Final slots = `min(distributedAllocation, localMemorySlots)`

**Error handling**:
- Jobs that throw without calling `reject()` do NOT release time-windowed capacity (safe by default)
- Call `reject(usage)` to explicitly report actual usage on failure

**Core Utilities** (`packages/core/src/utils/`):
- `rateLimiterClass.ts` - Main multi-model limiter
- `rateLimiterInternalClass.ts` - Single-model limiter
- `timeWindowCounter.ts` - TPM/RPM/TPD/RPD tracking
- `jobTypeManager.ts` - Dynamic ratio allocation
- `capacityWaitQueue.ts` - Queue for jobs waiting on capacity

## Code Quality Rules

**ESLint (strict)**:
- `max-lines-per-function`: 40 lines
- `max-lines`: 300 lines per file
- `max-depth`: 2 levels of nesting

When hitting these limits, **refactor properly**:
- Extract helper functions with meaningful names
- Split large files into smaller modules
- Never compress multiple statements onto single lines

**TypeScript**: Strict mode, ES2024 target, no `any` types.

## Design Documents

Detailed designs in `docs/`:
- `distributed-slots-design.md` - Pool-based allocation, local ratio management
- `distributed-capacity-tracking-design.md` - Global usage propagation across instances
- `actual-usage-adjustment-design.md` - Refund/overage handling, error scenarios
- `memory-based-slots-design.md` - Memory as local constraint
- `max-wait-timeout-design.md` - Queue timeout configuration per job type/model
- `e2e-distributed-tests-design.md` - Test architecture and config presets
