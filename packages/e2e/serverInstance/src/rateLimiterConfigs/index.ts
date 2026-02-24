/**
 * Configuration presets for E2E testing different scenarios.
 * Each preset defines models, escalation order, and resource estimations.
 */

// Re-export types
export type { RateLimiterPreset, ConfigPresetName } from './types.js';

// Re-export individual configs
export { capacityPlusOneConfig, defaultConfig } from './defaultConfig.js';
export {
  localRatioTwoTypesConfig,
  localRatioThreeTypesConfig,
  localRatioEqualThreeConfig,
  localRatioZeroAllocConfig,
} from './localRatioConfigs.js';
export {
  slotCalculationConfig,
  fixedRatioConfig,
  flexibleRatioConfig,
  instanceScalingConfig,
} from './slotTestConfigs.js';
export {
  slotCalcTpmConfig,
  slotCalcRpmConfig,
  slotCalcConcurrentConfig,
  slotCalcTpmRpmConfig,
  slotCalcMultiModelConfig,
} from './slotCalcLimitConfigs.js';
export {
  slotCalcRatiosConfig,
  slotCalcTpdConfig,
  slotCalcRpdConfig,
  slotCalcUnevenRatiosConfig,
  slotCalcMemoryConfig,
  slotCalcTpdRpdConfig,
  slotCalcZeroSlotsConfig,
  slotCalcRpmLimitingConfig,
} from './slotCalcRatioConfigs.js';
export { slotCalcTpmSingleConfig } from './slotCalcInstanceScalingConfig.js';

export {
  memCalcBasicConfig,
  memCalcDistributedWinsConfig,
  memCalcFreeRatioConfig,
  memCalcMemoryWinsConfig,
  memCalcRatiosConfig,
  memCalcZeroMemoryConfig,
} from './memoryCalcConfigs.js';

export {
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
export { mediumMaxWaitDefaultConfig } from './mediumMaxWaitDefaultConfig.js';
export { mediumRefundPartialRequestConfig } from './mediumRefundConfig.js';

export {
  mhMemoryConstrainConfig,
  mhMemoryRatioInteractConfig,
  mhMemoryDiffEstimatesConfig,
  mhMemoryAllLimitsConfig,
  mhEscalationThreeModelConfig,
  mhEscalationTpmConfig,
  mhEscalationRpmConfig,
  mhEscalationConcConfig,
  mhEscalationMultiTimeoutConfig,
  mhEscalationTpmWait5sConfig,
} from './mediumHighConfigs.js';
export { mhEscalationConcWait5sConfig } from './mediumHighEscalationConfigs.js';

export {
  highMultiResourceConfig,
  highMultiResourceMixedOverageConfig,
  highMultiModelConfig,
  highTwoLayerConfig,
  highTwoLayerEqualConfig,
  highTpmRpmTrackingConfig,
  highRpmTrackingConfig,
  highTimeWindowConfig,
} from './highTestConfigs.js';

export {
  highDistributedBasicConfig,
  highDistributedDailyLimitConfig,
  highDistributedThreeConfig,
  highDistributedMixedConfig,
  highDistributedTimeWindowConfig,
  highDistributedMultiModelConfig,
  highDistributedPubSubConfig,
  highDistributedWaitConfig,
} from './highDistributedConfigs.js';

export {
  highestMemoryDistributedConfig,
  highestMemoryDistributedLowTpmConfig,
  highestDistributedAcquireConfig,
  highestAcquireAtomicityConfig,
  highestDistributedWaitQueueConfig,
  highestDistributedEscalationConfig,
  highestJobPriorityConfig,
  highestHighConcurrencyConfig,
  highestHighConcurrencyEscalationConfig,
} from './highestTestConfigs.js';

export {
  highestEdgeFloorConfig,
  highestEdgeZeroFloorDivConfig,
  highestEdgeZeroSlotsConfig,
  highestEdgeZeroMemoryConfig,
  highestEdgeLargeMemoryConfig,
  highestEdgeAllFixedConfig,
  highestEdgeSingleFlexConfig,
} from './edgeCaseConfigs.js';

export { aiWorkloadConfig } from './aiWorkloadConfig.js';
export { megaComprehensiveConfig } from './megaComprehensiveConfig.js';

// Re-export registry and helpers from registry file
export { configPresets, getConfigPreset, isValidPresetName } from './registry.js';
