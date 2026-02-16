# E2E Test Reference

This document provides detailed documentation for each e2e test file, including their purpose, configuration, and test cases.

## Test Summary

| Test File | Complexity | Implemented | Passing |
|-----------|------------|:-----------:|:-------:|
| `infrastructureBoot.test.ts` | [Lowest](./complexity-lowest.md) | [x] | [x] |
| `slotCalculation.test.ts` | [Low](./complexity-low.md#1-pool-slot-calculation) | [x] | [x] |
| `slotCalculationAdditional.test.ts` | [Low](./complexity-low.md#1-pool-slot-calculation) | [x] | [x] |
| `localRatioDistribution.test.ts` | [Low](./complexity-low.md#2-local-ratio-distribution) | [x] | [x] |
| `memorySlotCalculation.test.ts` | [Low](./complexity-low.md#3-memory-slot-calculation) | [x] | [x] |
| `singleJobOperations.test.ts` | [Low](./complexity-low.md#4-single-job-operations) | [x] | [x] |
| `exactCapacity.test.ts` | [Low](./complexity-low.md#5-exact-capacity-test) | [x] | [x] |
| `capacityPlusOne.test.ts` | [Low](./complexity-low.md#6-capacity-plus-one-test) | [x] | [x] |
| `fixedRatioIsolation.test.ts` | [Low](./complexity-low.md#7-fixed-ratio-isolation-test) | [x] | [x] |
| `rateLimitQueuing.test.ts` | [Low](./complexity-low.md#8-rate-limit-queuing-test) | [x] | [x] |
| `actualUsageRefunds.test.ts` | [Medium](./complexity-medium.md#9-actual-usage-refunds) | [x] | [x] |
| `actualUsageRefundsAdditional.test.ts` | [Medium](./complexity-medium.md#9-actual-usage-refunds) | [x] | [x] |
| `actualUsageOverages.test.ts` | [Medium](./complexity-medium.md#10-actual-usage-overages) | [x] | [x] |
| `actualUsageOveragesAdditional.test.ts` | [Medium](./complexity-medium.md#10-actual-usage-overages) | [x] | [x] |
| `tokenTypeBreakdown.test.ts` | [Medium](./complexity-medium.md#11-token-type-breakdown) | [x] | [x] |
| `errorHandling.test.ts` | [Medium](./complexity-medium.md#12-error-handling) | [x] | [x] |
| `errorHandlingAdditional.test.ts` | [Medium](./complexity-medium.md#12-error-handling) | [x] | [x] |
| `queueBehavior.test.ts` | [Medium](./complexity-medium.md#13-queue-behavior) | [x] | [x] |
| `queueBehaviorAdditional.test.ts` | [Medium](./complexity-medium.md#13-queue-behavior) | [x] | [x] |
| `maxWaitMsBehavior.test.ts` | [Medium](./complexity-medium.md#14-maxwaitms-behavior) | [x] | [x] |
| `maxWaitMsBehaviorAdditional.test.ts` | [Medium](./complexity-medium.md#14-maxwaitms-behavior) | [x] | [x] |
| `slotsEvolveWithLoad.test.ts` | [Medium](./complexity-medium.md#15-slots-evolve-with-load-test) | [x] | [x] |
| `fixedRatioProtection.test.ts` | [Medium](./complexity-medium.md#16-fixed-ratio-protection) | [x] | [x] |
| `flexibleRatioAdjustment.test.ts` | [Medium-High](./complexity-medium-high.md#17-flexible-ratio-adjustment-test) | [x] | [x] |
| `memoryConstraintEnforcement.test.ts` | [Medium-High](./complexity-medium-high.md#18-memory-constraint-enforcement) | [x] | [x] |
| `modelEscalationBasic.test.ts` | [Medium-High](./complexity-medium-high.md#19-model-escalation---basic) | [x] | [x] |
| `modelEscalationRateLimits.test.ts` | [Medium-High](./complexity-medium-high.md#20-model-escalation---rate-limit-types) | [x] | [x] |
| `modelEscalationTimeout.test.ts` | [Medium-High](./complexity-medium-high.md#21-model-escalation---timeout) | [x] | [x] |
| `modelEscalationCapacityTracking.test.ts` | [Medium-High](./complexity-medium-high.md#22-model-escalation---capacity-tracking) | [x] | [x] |
| `instanceScaling.test.ts` | [High](./complexity-high.md#23-instance-scaling-test) | [x] | [x] |
| `twoLayerAcquireRelease.test.ts` | [High](./complexity-high.md#24-two-layer-acquirerelease) | [x] | [x] |
| `twoLayerAcquireReleaseAdditional.test.ts` | [High](./complexity-high.md#24-two-layer-acquirerelease) | [x] | [x] |
| `multiModelIndependence.test.ts` | [High](./complexity-high.md#25-multi-model-independence) | [x] | [x] |
| `multiResourceAdjustment.test.ts` | [High](./complexity-high.md#26-multi-resource-adjustment) | [x] | [x] |
| `timeWindowHandling.test.ts` | [High](./complexity-high.md#27-time-window-handling) | [x] | [x] |
| `distributedInstanceScaling.test.ts` | [High](./complexity-high.md#28-distributed---instance-scaling) | [x] | [x] |
| `distributedGlobalUsageTracking.test.ts` | [High](./complexity-high.md#29-distributed---global-usage-tracking) | [x] | [x] |
| `distributedCrossInstancePropagation.test.ts` | [High](./complexity-high.md#30-distributed---cross-instance-propagation) | [x] | [x] |
| `distributedPubSub.test.ts` | [High](./complexity-high.md#31-distributed---pubsub) | [x] | [x] |
| `distributedDynamicLimits.test.ts` | [High](./complexity-high.md#32-distributed---dynamic-limits) | [x] | [x] |
| `distributedTimeWindows.test.ts` | [High](./complexity-high.md#33-distributed---time-windows) | [x] | [x] |
| `distributedRequestCountTracking.test.ts` | [High](./complexity-high.md#34-distributed---request-count-tracking) | [x] | [x] |
| `distributedMultiModelTracking.test.ts` | [High](./complexity-high.md#35-distributed---multi-model-tracking) | [x] | [x] |
| `modelEscalation.test.ts` | [High](./complexity-high.md#48-model-escalation-test-legacy) | [x] | [x] |
| `modelEscalationToThird.test.ts` | [High](./complexity-high.md#49-model-escalation-to-third-model-test-legacy) | [x] | [x] |
| `localRatioOnly.test.ts` | [Highest](./complexity-highest.md#36-local-ratio-only-test) | [x] | [x] |
| `distributedRatioManagement.test.ts` | [Highest](./complexity-highest.md#37-distributed---ratio-management) | [x] | [x] |
| `distributedMemoryIndependence.test.ts` | [Highest](./complexity-highest.md#38-distributed---memory-independence) | [x] | [x] |
| `distributedAcquireRelease.test.ts` | [Highest](./complexity-highest.md#39-distributed---acquirerelease) | [x] | [x] |
| `distributedWaitQueue.test.ts` | [Highest](./complexity-highest.md#40-distributed---wait-queue) | [x] | [x] |
| `distributedEscalation.test.ts` | [Highest](./complexity-highest.md#41-distributed---escalation) | [x] | [x] |
| `redisKeyManagement.test.ts` | [Highest](./complexity-highest.md#43-redis-key-management) | [x] | [x] |
| `zeroActualUsage.test.ts` | [Highest](./complexity-highest.md#44-zero-actual-usage) | [x] | [x] |
| `jobPriority.test.ts` | [Highest](./complexity-highest.md#45-job-priority) | [x] | [x] |
| `highConcurrency.test.ts` | [Highest](./complexity-highest.md#46-high-concurrency) | [x] | [x] |
| `edgeCases.test.ts` | [Highest](./complexity-highest.md#47-edge-cases) | [x] | [x] |
| `edgeCasesAdditional.test.ts` | [Highest](./complexity-highest.md#47-edge-cases) | [x] | [x] |
| `megaComprehensive.test.ts` | [Comprehensive](./complexity-comprehensive.md#50-mega-comprehensive-test) | [ ] | [ ] |
| `megaComprehensiveAdditional.test.ts` | [Comprehensive](./complexity-comprehensive.md#50-mega-comprehensive-test) | [ ] | [ ] |

## Detailed Documentation by Complexity

- [Lowest Complexity Tests](./complexity-lowest.md) - Infrastructure verification
- [Low Complexity Tests](./complexity-low.md) - Basic slot calculations and single operations
- [Medium Complexity Tests](./complexity-medium.md) - Refunds, overages, queue behavior
- [Medium-High Complexity Tests](./complexity-medium-high.md) - Ratio adjustments, memory constraints, model escalation basics
- [High Complexity Tests](./complexity-high.md) - Multi-model, distributed basics, time windows
- [Highest Complexity Tests](./complexity-highest.md) - Advanced distributed scenarios, edge cases
- [Comprehensive Mega Test](./complexity-comprehensive.md) - 50/52 features in a single 3-minute run
