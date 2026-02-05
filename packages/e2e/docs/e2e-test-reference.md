# E2E Test Reference

This document provides detailed documentation for each e2e test file, including their purpose, configuration, and test cases.

## Test Summary

| Test File | Complexity | Implemented | Passing |
|-----------|------------|:-----------:|:-------:|
| `infrastructureBoot.test.ts` | [Lowest](./complexity-lowest.md) | [ ] | [ ] |
| `slotCalculation.test.ts` | [Low](./complexity-low.md#1-pool-slot-calculation) | [ ] | [ ] |
| `localRatioDistribution.test.ts` | [Low](./complexity-low.md#2-local-ratio-distribution) | [ ] | [ ] |
| `memorySlotCalculation.test.ts` | [Low](./complexity-low.md#3-memory-slot-calculation) | [ ] | [ ] |
| `singleJobOperations.test.ts` | [Low](./complexity-low.md#4-single-job-operations) | [ ] | [ ] |
| `exactCapacity.test.ts` | [Low](./complexity-low.md#5-exact-capacity-test) | [ ] | [ ] |
| `capacityPlusOne.test.ts` | [Low](./complexity-low.md#6-capacity-plus-one-test) | [ ] | [ ] |
| `fixedRatioIsolation.test.ts` | [Low](./complexity-low.md#7-fixed-ratio-isolation-test) | [ ] | [ ] |
| `rateLimitQueuing.test.ts` | [Low](./complexity-low.md#8-rate-limit-queuing-test) | [ ] | [ ] |
| `actualUsageRefunds.test.ts` | [Medium](./complexity-medium.md#9-actual-usage-refunds) | [ ] | [ ] |
| `actualUsageOverages.test.ts` | [Medium](./complexity-medium.md#10-actual-usage-overages) | [ ] | [ ] |
| `tokenTypeBreakdown.test.ts` | [Medium](./complexity-medium.md#11-token-type-breakdown) | [ ] | [ ] |
| `errorHandling.test.ts` | [Medium](./complexity-medium.md#12-error-handling) | [ ] | [ ] |
| `queueBehavior.test.ts` | [Medium](./complexity-medium.md#13-queue-behavior) | [ ] | [ ] |
| `maxWaitMsBehavior.test.ts` | [Medium](./complexity-medium.md#14-maxwaitms-behavior) | [ ] | [ ] |
| `slotsEvolveWithLoad.test.ts` | [Medium](./complexity-medium.md#15-slots-evolve-with-load-test) | [ ] | [ ] |
| `fixedRatioProtection.test.ts` | [Medium](./complexity-medium.md#16-fixed-ratio-protection) | [ ] | [ ] |
| `flexibleRatioAdjustment.test.ts` | [Medium-High](./complexity-medium-high.md#17-flexible-ratio-adjustment-test) | [ ] | [ ] |
| `memoryConstraintEnforcement.test.ts` | [Medium-High](./complexity-medium-high.md#18-memory-constraint-enforcement) | [ ] | [ ] |
| `modelEscalationBasic.test.ts` | [Medium-High](./complexity-medium-high.md#19-model-escalation---basic) | [ ] | [ ] |
| `modelEscalationRateLimits.test.ts` | [Medium-High](./complexity-medium-high.md#20-model-escalation---rate-limit-types) | [ ] | [ ] |
| `modelEscalationTimeout.test.ts` | [Medium-High](./complexity-medium-high.md#21-model-escalation---timeout) | [ ] | [ ] |
| `modelEscalationCapacityTracking.test.ts` | [Medium-High](./complexity-medium-high.md#22-model-escalation---capacity-tracking) | [ ] | [ ] |
| `instanceScaling.test.ts` | [High](./complexity-high.md#23-instance-scaling-test) | [ ] | [ ] |
| `twoLayerAcquireRelease.test.ts` | [High](./complexity-high.md#24-two-layer-acquirerelease) | [ ] | [ ] |
| `multiModelIndependence.test.ts` | [High](./complexity-high.md#25-multi-model-independence) | [ ] | [ ] |
| `multiResourceAdjustment.test.ts` | [High](./complexity-high.md#26-multi-resource-adjustment) | [ ] | [ ] |
| `timeWindowHandling.test.ts` | [High](./complexity-high.md#27-time-window-handling) | [ ] | [ ] |
| `distributedInstanceScaling.test.ts` | [High](./complexity-high.md#28-distributed---instance-scaling) | [ ] | [ ] |
| `distributedGlobalUsageTracking.test.ts` | [High](./complexity-high.md#29-distributed---global-usage-tracking) | [ ] | [ ] |
| `distributedCrossInstancePropagation.test.ts` | [High](./complexity-high.md#30-distributed---cross-instance-propagation) | [ ] | [ ] |
| `distributedPubSub.test.ts` | [High](./complexity-high.md#31-distributed---pubsub) | [ ] | [ ] |
| `distributedDynamicLimits.test.ts` | [High](./complexity-high.md#32-distributed---dynamic-limits) | [ ] | [ ] |
| `distributedTimeWindows.test.ts` | [High](./complexity-high.md#33-distributed---time-windows) | [ ] | [ ] |
| `distributedRequestCountTracking.test.ts` | [High](./complexity-high.md#34-distributed---request-count-tracking) | [ ] | [ ] |
| `distributedMultiModelTracking.test.ts` | [High](./complexity-high.md#35-distributed---multi-model-tracking) | [ ] | [ ] |
| `modelEscalation.test.ts` | [High](./complexity-high.md#48-model-escalation-test-legacy) | [ ] | [ ] |
| `modelEscalationToThird.test.ts` | [High](./complexity-high.md#49-model-escalation-to-third-model-test-legacy) | [ ] | [ ] |
| `localRatioOnly.test.ts` | [Highest](./complexity-highest.md#36-local-ratio-only-test) | [ ] | [ ] |
| `distributedRatioManagement.test.ts` | [Highest](./complexity-highest.md#37-distributed---ratio-management) | [ ] | [ ] |
| `distributedMemoryIndependence.test.ts` | [Highest](./complexity-highest.md#38-distributed---memory-independence) | [ ] | [ ] |
| `distributedAcquireRelease.test.ts` | [Highest](./complexity-highest.md#39-distributed---acquirerelease) | [ ] | [ ] |
| `distributedWaitQueue.test.ts` | [Highest](./complexity-highest.md#40-distributed---wait-queue) | [ ] | [ ] |
| `distributedEscalation.test.ts` | [Highest](./complexity-highest.md#41-distributed---escalation) | [ ] | [ ] |
| `distributedGracefulDegradation.test.ts` | [Highest](./complexity-highest.md#42-distributed---graceful-degradation) | [ ] | [ ] |
| `redisKeyManagement.test.ts` | [Highest](./complexity-highest.md#43-redis-key-management) | [ ] | [ ] |
| `zeroActualUsage.test.ts` | [Highest](./complexity-highest.md#44-zero-actual-usage) | [ ] | [ ] |
| `jobPriority.test.ts` | [Highest](./complexity-highest.md#45-job-priority) | [ ] | [ ] |
| `highConcurrency.test.ts` | [Highest](./complexity-highest.md#46-high-concurrency) | [ ] | [ ] |
| `edgeCases.test.ts` | [Highest](./complexity-highest.md#47-edge-cases) | [ ] | [ ] |

## Detailed Documentation by Complexity

- [Lowest Complexity Tests](./complexity-lowest.md) - Infrastructure verification
- [Low Complexity Tests](./complexity-low.md) - Basic slot calculations and single operations
- [Medium Complexity Tests](./complexity-medium.md) - Refunds, overages, queue behavior
- [Medium-High Complexity Tests](./complexity-medium-high.md) - Ratio adjustments, memory constraints, model escalation basics
- [High Complexity Tests](./complexity-high.md) - Multi-model, distributed basics, time windows
- [Highest Complexity Tests](./complexity-highest.md) - Advanced distributed scenarios, edge cases
