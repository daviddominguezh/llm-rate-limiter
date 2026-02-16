/**
 * Configuration preset registry and helper functions.
 */
import { capacityPlusOneConfig, defaultConfig } from './defaultConfig.js';
import {
  highestEdgeAllFixedConfig,
  highestEdgeFloorConfig,
  highestEdgeLargeMemoryConfig,
  highestEdgeSingleFlexConfig,
  highestEdgeZeroFloorDivConfig,
  highestEdgeZeroMemoryConfig,
  highestEdgeZeroSlotsConfig,
} from './edgeCaseConfigs.js';
import {
  highDistributedBasicConfig,
  highDistributedDailyLimitConfig,
  highDistributedMixedConfig,
  highDistributedMultiModelConfig,
  highDistributedPubSubConfig,
  highDistributedThreeConfig,
  highDistributedTimeWindowConfig,
  highDistributedWaitConfig,
} from './highDistributedConfigs.js';
import {
  highMultiModelConfig,
  highMultiResourceConfig,
  highMultiResourceMixedOverageConfig,
  highRpmTrackingConfig,
  highTimeWindowConfig,
  highTpmRpmTrackingConfig,
  highTwoLayerConfig,
  highTwoLayerEqualConfig,
} from './highTestConfigs.js';
import {
  highestAcquireAtomicityConfig,
  highestDistributedAcquireConfig,
  highestDistributedEscalationConfig,
  highestDistributedWaitQueueConfig,
  highestHighConcurrencyConfig,
  highestHighConcurrencyEscalationConfig,
  highestJobPriorityConfig,
  highestMemoryDistributedConfig,
  highestMemoryDistributedLowTpmConfig,
} from './highestTestConfigs.js';
import {
  localRatioEqualThreeConfig,
  localRatioThreeTypesConfig,
  localRatioTwoTypesConfig,
  localRatioZeroAllocConfig,
} from './localRatioConfigs.js';
import {
  mhEscalationConcConfig,
  mhEscalationMultiTimeoutConfig,
  mhEscalationRpmConfig,
  mhEscalationThreeModelConfig,
  mhEscalationTpmConfig,
  mhEscalationTpmWait5sConfig,
  mhMemoryAllLimitsConfig,
  mhMemoryConstrainConfig,
  mhMemoryDiffEstimatesConfig,
  mhMemoryRatioInteractConfig,
} from './mediumHighConfigs.js';
import { mhEscalationConcWait5sConfig } from './mediumHighEscalationConfigs.js';
import { mediumMaxWaitDefaultConfig } from './mediumMaxWaitDefaultConfig.js';
import { mediumRefundPartialRequestConfig } from './mediumRefundConfig.js';
import {
  mediumErrorMemoryConfig,
  mediumFixedProtectionMultiFixedConfig,
  mediumFixedProtectionThreeTypeConfig,
  mediumFixedProtectionTwoTypeConfig,
  mediumMaxWaitExplicitConfig,
  mediumMaxWaitPerModelConfig,
  mediumMaxWaitReleaseConfig,
  mediumMaxWaitSingleModelConfig,
  mediumMaxWaitTimeoutConfig,
  mediumMaxWaitTwoModelConfig,
  mediumQueueConcurrentConfig,
} from './mediumTestConfigs.js';
import { megaComprehensiveConfig } from './megaComprehensiveConfig.js';
import {
  memCalcBasicConfig,
  memCalcDistributedWinsConfig,
  memCalcFreeRatioConfig,
  memCalcMemoryWinsConfig,
  memCalcRatiosConfig,
  memCalcZeroMemoryConfig,
} from './memoryCalcConfigs.js';
import { slotCalcTpmSingleConfig } from './slotCalcInstanceScalingConfig.js';
import {
  slotCalcConcurrentConfig,
  slotCalcMultiModelConfig,
  slotCalcRpmConfig,
  slotCalcTpmConfig,
  slotCalcTpmRpmConfig,
} from './slotCalcLimitConfigs.js';
import {
  slotCalcMemoryConfig,
  slotCalcRatiosConfig,
  slotCalcRpdConfig,
  slotCalcRpmLimitingConfig,
  slotCalcTpdConfig,
  slotCalcTpdRpdConfig,
  slotCalcUnevenRatiosConfig,
  slotCalcZeroSlotsConfig,
} from './slotCalcRatioConfigs.js';
import {
  fixedRatioConfig,
  flexibleRatioConfig,
  instanceScalingConfig,
  slotCalculationConfig,
} from './slotTestConfigs.js';
import type { ConfigPresetName, RateLimiterPreset } from './types.js';

/** Registry of all configuration presets */
export const configPresets: Record<ConfigPresetName, RateLimiterPreset> = {
  default: defaultConfig,
  capacityPlusOne: capacityPlusOneConfig,
  slotCalculation: slotCalculationConfig,
  fixedRatio: fixedRatioConfig,
  flexibleRatio: flexibleRatioConfig,
  instanceScaling: instanceScalingConfig,
  'slotCalc-tpm': slotCalcTpmConfig,
  'slotCalc-rpm': slotCalcRpmConfig,
  'slotCalc-tpd': slotCalcTpdConfig,
  'slotCalc-rpd': slotCalcRpdConfig,
  'slotCalc-concurrent': slotCalcConcurrentConfig,
  'slotCalc-tpm-rpm': slotCalcTpmRpmConfig,
  'slotCalc-multi-model': slotCalcMultiModelConfig,
  'slotCalc-ratios': slotCalcRatiosConfig,
  'slotCalc-uneven-ratios': slotCalcUnevenRatiosConfig,
  'slotCalc-memory': slotCalcMemoryConfig,
  'slotCalc-tpd-rpd': slotCalcTpdRpdConfig,
  'slotCalc-zero-slots': slotCalcZeroSlotsConfig,
  'slotCalc-rpm-limiting': slotCalcRpmLimitingConfig,
  'slotCalc-tpm-single': slotCalcTpmSingleConfig,
  'localRatio-twoTypes': localRatioTwoTypesConfig,
  'localRatio-threeTypes': localRatioThreeTypesConfig,
  'localRatio-equalThree': localRatioEqualThreeConfig,
  'localRatio-zeroAlloc': localRatioZeroAllocConfig,
  'memCalc-basic': memCalcBasicConfig,
  'memCalc-memoryWins': memCalcMemoryWinsConfig,
  'memCalc-distributedWins': memCalcDistributedWinsConfig,
  'memCalc-ratios': memCalcRatiosConfig,
  'memCalc-zeroMemory': memCalcZeroMemoryConfig,
  'memCalc-freeRatio': memCalcFreeRatioConfig,
  'medium-maxWait-twoModel': mediumMaxWaitTwoModelConfig,
  'medium-maxWait-singleModel': mediumMaxWaitSingleModelConfig,
  'medium-maxWait-explicit': mediumMaxWaitExplicitConfig,
  'medium-maxWait-timeout': mediumMaxWaitTimeoutConfig,
  'medium-maxWait-release': mediumMaxWaitReleaseConfig,
  'medium-maxWait-perModel': mediumMaxWaitPerModelConfig,
  'medium-maxWait-default': mediumMaxWaitDefaultConfig,
  'medium-queue-concurrent': mediumQueueConcurrentConfig,
  'medium-errorMemory': mediumErrorMemoryConfig,
  'medium-fixedProtection-twoType': mediumFixedProtectionTwoTypeConfig,
  'medium-fixedProtection-threeType': mediumFixedProtectionThreeTypeConfig,
  'medium-fixedProtection-multiFixed': mediumFixedProtectionMultiFixedConfig,
  'mh-memoryConstrain': mhMemoryConstrainConfig,
  'mh-memoryRatioInteract': mhMemoryRatioInteractConfig,
  'mh-memoryDiffEstimates': mhMemoryDiffEstimatesConfig,
  'mh-memoryAllLimits': mhMemoryAllLimitsConfig,
  'mh-escalationThreeModel': mhEscalationThreeModelConfig,
  'mh-escalationTpm': mhEscalationTpmConfig,
  'mh-escalationRpm': mhEscalationRpmConfig,
  'mh-escalationConc': mhEscalationConcConfig,
  'mh-escalationMultiTimeout': mhEscalationMultiTimeoutConfig,
  'mh-escalationTpmWait5s': mhEscalationTpmWait5sConfig,
  'mh-escalationConcWait5s': mhEscalationConcWait5sConfig,
  'high-multiResource': highMultiResourceConfig,
  'high-multiModel': highMultiModelConfig,
  'high-twoLayerEqual': highTwoLayerEqualConfig,
  'high-twoLayer': highTwoLayerConfig,
  'high-tpmRpmTracking': highTpmRpmTrackingConfig,
  'high-timeWindow': highTimeWindowConfig,
  'high-rpmTracking': highRpmTrackingConfig,
  'high-distributedBasic': highDistributedBasicConfig,
  'high-distributedThree': highDistributedThreeConfig,
  'high-distributedMixed': highDistributedMixedConfig,
  'high-distributedTimeWindow': highDistributedTimeWindowConfig,
  'high-distributedDailyLimit': highDistributedDailyLimitConfig,
  'high-distributedMultiModel': highDistributedMultiModelConfig,
  'high-distributedPubSub': highDistributedPubSubConfig,
  'high-distributedWait': highDistributedWaitConfig,
  'highest-memoryDistributed': highestMemoryDistributedConfig,
  'highest-distributedAcquire': highestDistributedAcquireConfig,
  'highest-acquireAtomicity': highestAcquireAtomicityConfig,
  'highest-distributedWaitQueue': highestDistributedWaitQueueConfig,
  'highest-distributedEscalation': highestDistributedEscalationConfig,
  'highest-jobPriority': highestJobPriorityConfig,
  'highest-highConcurrency': highestHighConcurrencyConfig,
  'highest-highConcurrencyEscalation': highestHighConcurrencyEscalationConfig,
  'highest-edgeFloor': highestEdgeFloorConfig,
  'highest-edgeZeroSlots': highestEdgeZeroSlotsConfig,
  'highest-edgeZeroMemory': highestEdgeZeroMemoryConfig,
  'highest-edgeLargeMemory': highestEdgeLargeMemoryConfig,
  'highest-edgeAllFixed': highestEdgeAllFixedConfig,
  'highest-edgeSingleFlex': highestEdgeSingleFlexConfig,
  'high-multiResource-mixedOverage': highMultiResourceMixedOverageConfig,
  'medium-refund-partialRequest': mediumRefundPartialRequestConfig,
  'highest-edgeZeroFloorDiv': highestEdgeZeroFloorDivConfig,
  'highest-memoryDistributed-lowTPM': highestMemoryDistributedLowTpmConfig,
  'mega-comprehensive': megaComprehensiveConfig,
};

/** Get a configuration preset by name */
export const getConfigPreset = (name: ConfigPresetName): RateLimiterPreset => configPresets[name];

/** Check if a string is a valid preset name */
export const isValidPresetName = (name: string): name is ConfigPresetName => name in configPresets;
