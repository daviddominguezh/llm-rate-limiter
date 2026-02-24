/**
 * Type definitions for rate limiter configuration presets.
 */
import type {
  MemoryLimitConfig,
  RatioAdjustmentConfig,
  ResourceEstimationsPerJob,
} from '@llm-rate-limiter/core';

export interface RateLimiterPreset {
  models: Record<
    string,
    {
      requestsPerMinute?: number;
      requestsPerDay?: number;
      tokensPerMinute?: number;
      tokensPerDay?: number;
      maxConcurrentRequests?: number;
      pricing: {
        input: number;
        cached: number;
        output: number;
      };
    }
  >;
  escalationOrder: readonly string[];
  resourceEstimations: ResourceEstimationsPerJob;
  ratioAdjustmentConfig?: RatioAdjustmentConfig;
  memory?: MemoryLimitConfig;
}

export type ConfigPresetName =
  | 'default'
  | 'capacityPlusOne'
  | 'slotCalculation'
  | 'fixedRatio'
  | 'flexibleRatio'
  | 'instanceScaling'
  | 'slotCalc-tpm'
  | 'slotCalc-rpm'
  | 'slotCalc-tpd'
  | 'slotCalc-rpd'
  | 'slotCalc-concurrent'
  | 'slotCalc-tpm-rpm'
  | 'slotCalc-multi-model'
  | 'slotCalc-ratios'
  | 'slotCalc-uneven-ratios'
  | 'slotCalc-memory'
  | 'slotCalc-tpd-rpd'
  | 'slotCalc-zero-slots'
  | 'slotCalc-rpm-limiting'
  | 'slotCalc-tpm-single'
  | 'localRatio-twoTypes'
  | 'localRatio-threeTypes'
  | 'localRatio-equalThree'
  | 'localRatio-zeroAlloc'
  | 'memCalc-basic'
  | 'memCalc-memoryWins'
  | 'memCalc-distributedWins'
  | 'memCalc-ratios'
  | 'memCalc-zeroMemory'
  | 'memCalc-freeRatio'
  | 'medium-maxWait-twoModel'
  | 'medium-maxWait-singleModel'
  | 'medium-maxWait-explicit'
  | 'medium-maxWait-timeout'
  | 'medium-maxWait-release'
  | 'medium-maxWait-perModel'
  | 'medium-maxWait-default'
  | 'medium-queue-concurrent'
  | 'medium-errorMemory'
  | 'medium-fixedProtection-twoType'
  | 'medium-fixedProtection-threeType'
  | 'medium-fixedProtection-multiFixed'
  | 'mh-memoryConstrain'
  | 'mh-memoryRatioInteract'
  | 'mh-memoryDiffEstimates'
  | 'mh-memoryAllLimits'
  | 'mh-escalationThreeModel'
  | 'mh-escalationTpm'
  | 'mh-escalationRpm'
  | 'mh-escalationConc'
  | 'mh-escalationMultiTimeout'
  | 'mh-escalationTpmWait5s'
  | 'mh-escalationConcWait5s'
  | 'high-multiResource'
  | 'high-multiModel'
  | 'high-twoLayerEqual'
  | 'high-twoLayer'
  | 'high-tpmRpmTracking'
  | 'high-timeWindow'
  | 'high-rpmTracking'
  | 'high-distributedBasic'
  | 'high-distributedThree'
  | 'high-distributedMixed'
  | 'high-distributedTimeWindow'
  | 'high-distributedDailyLimit'
  | 'high-distributedMultiModel'
  | 'high-distributedPubSub'
  | 'high-distributedWait'
  | 'highest-memoryDistributed'
  | 'highest-distributedAcquire'
  | 'highest-acquireAtomicity'
  | 'highest-distributedWaitQueue'
  | 'highest-distributedEscalation'
  | 'highest-jobPriority'
  | 'highest-highConcurrency'
  | 'highest-highConcurrencyEscalation'
  | 'highest-edgeFloor'
  | 'highest-edgeZeroSlots'
  | 'highest-edgeZeroMemory'
  | 'highest-edgeLargeMemory'
  | 'highest-edgeAllFixed'
  | 'highest-edgeSingleFlex'
  | 'high-multiResource-mixedOverage'
  | 'medium-refund-partialRequest'
  | 'highest-edgeZeroFloorDiv'
  | 'highest-memoryDistributed-lowTPM'
  | 'mega-comprehensive'
  | 'ai-workload';
