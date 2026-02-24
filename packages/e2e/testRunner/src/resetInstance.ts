/**
 * Utility to reset a server instance via its debug endpoint.
 */

const HTTP_OK = 200;
const ZERO_KEYS = 0;

/** Valid config preset names */
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

/** Options for resetting an instance */
export interface ResetOptions {
  /** Whether to clean Redis keys (default: true). Set to false when multiple instances share Redis. */
  cleanRedis?: boolean;
  /** Configuration preset to use after reset */
  configPreset?: ConfigPresetName;
}

/** Result of a reset operation */
export interface ResetResult {
  success: boolean;
  keysDeleted: number;
  newInstanceId: string;
  error?: string;
}

/**
 * Build the request body for reset
 */
const buildRequestBody = (options: ResetOptions): string => {
  const { cleanRedis = true, configPreset } = options;
  const requestBody: { cleanRedis: boolean; configPreset?: ConfigPresetName } = { cleanRedis };
  if (configPreset !== undefined) {
    requestBody.configPreset = configPreset;
  }
  return JSON.stringify(requestBody);
};

/**
 * Create error result
 */
const createErrorResult = (error: string): ResetResult => ({
  success: false,
  keysDeleted: ZERO_KEYS,
  newInstanceId: '',
  error,
});

/**
 * Type guard for ResetResult
 */
const isResetResult = (value: unknown): value is ResetResult =>
  typeof value === 'object' && value !== null && 'keysDeleted' in value && 'newInstanceId' in value;

/**
 * Parse response body safely
 */
const parseResponseSafely = (data: unknown): ResetResult | null => {
  if (isResetResult(data)) {
    return data;
  }
  return null;
};

/**
 * Handle successful HTTP response
 */
const handleSuccessResponse = (data: unknown): ResetResult => {
  const parsed = parseResponseSafely(data);
  if (parsed === null) {
    return createErrorResult('Failed to parse response');
  }
  return {
    success: true,
    keysDeleted: parsed.keysDeleted,
    newInstanceId: parsed.newInstanceId,
  };
};

/**
 * Reset a server instance by calling POST /api/debug/reset.
 * @param baseUrl - The base URL of the server instance
 * @param options - Reset options (cleanRedis defaults to true)
 */
export const resetInstance = async (baseUrl: string, options: ResetOptions = {}): Promise<ResetResult> => {
  const body = buildRequestBody(options);

  try {
    const response = await fetch(`${baseUrl}/api/debug/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (response.status === HTTP_OK) {
      const data: unknown = await response.json();
      return handleSuccessResponse(data);
    }

    const errorText = await response.text();
    return createErrorResult(`HTTP ${String(response.status)}: ${errorText}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult(errorMessage);
  }
};
