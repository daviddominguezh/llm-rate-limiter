/**
 * Validation utilities for job type configuration.
 */
import type { JobTypeResourceConfig, ResourcesPerJob } from '../jobTypeTypes.js';

const ZERO = 0;
const ONE = 1;
const EPSILON = 0.0001;
const PRECISION_DIGITS = 4;
const HIGH_PRECISION_DIGITS = 6;

/**
 * Result of ratio calculation containing initial ratios for all job types.
 */
export interface CalculatedRatios {
  /** Map of job type ID to its calculated initial ratio */
  ratios: Map<string, number>;
  /** Sum of all ratios (should be 1 within epsilon) */
  totalRatio: number;
}

/**
 * Validates a single job type's ratio configuration.
 * @throws Error if initialValue is out of range (0, 1]
 */
const validateJobTypeRatio = (jobTypeId: string, config: JobTypeResourceConfig): void => {
  const { ratio } = config;
  if (ratio?.initialValue !== undefined) {
    if (ratio.initialValue <= ZERO) {
      throw new Error(
        `Job type '${jobTypeId}' ratio.initialValue must be greater than 0. Got: ${ratio.initialValue}`
      );
    }
    if (ratio.initialValue > ONE) {
      throw new Error(
        `Job type '${jobTypeId}' ratio.initialValue must be at most 1. Got: ${ratio.initialValue}`
      );
    }
  }
};

/**
 * Validates the entire resourcesPerJob configuration.
 * @throws Error if:
 *   - resourcesPerJob is empty
 *   - Any initialValue is out of range (0, 1]
 *   - Sum of specified initialValue exceeds 1
 */
export const validateJobTypeConfig = (resourcesPerJob: ResourcesPerJob): void => {
  const jobTypes = Object.keys(resourcesPerJob);

  if (jobTypes.length === ZERO) {
    throw new Error('resourcesPerJob must contain at least one job type');
  }

  let specifiedRatioSum = ZERO;

  for (const [jobTypeId, config] of Object.entries(resourcesPerJob)) {
    validateJobTypeRatio(jobTypeId, config);

    if (config.ratio?.initialValue !== undefined) {
      specifiedRatioSum += config.ratio.initialValue;
    }
  }

  // Check that specified ratios don't exceed 1
  if (specifiedRatioSum > ONE + EPSILON) {
    throw new Error(
      `Sum of specified ratio.initialValue values exceeds 1. ` +
        `Got: ${specifiedRatioSum.toFixed(PRECISION_DIGITS)}. ` +
        `Reduce some initialValue values to leave room for other job types.`
    );
  }
};

/**
 * Calculates initial ratios for all job types.
 *
 * Logic:
 * 1. Job types with specified initialValue get their specified ratio
 * 2. Remaining capacity (1 - sum of specified) is distributed evenly
 *    among job types without an initialValue
 * 3. If all job types have specified initialValue that sums to less than 1,
 *    the ratios are normalized to sum to 1
 *
 * @param resourcesPerJob - The job type configuration
 * @returns Map of job type ID to calculated ratio
 */
export const calculateInitialRatios = (resourcesPerJob: ResourcesPerJob): CalculatedRatios => {
  const ratios = new Map<string, number>();
  const jobTypes = Object.entries(resourcesPerJob);

  let specifiedSum = ZERO;
  const unspecifiedJobTypes: string[] = [];

  // First pass: collect specified ratios and identify unspecified ones
  for (const [jobTypeId, config] of jobTypes) {
    if (config.ratio?.initialValue === undefined) {
      unspecifiedJobTypes.push(jobTypeId);
    } else {
      ratios.set(jobTypeId, config.ratio.initialValue);
      specifiedSum += config.ratio.initialValue;
    }
  }

  // Calculate remainder to distribute
  const remainder = ONE - specifiedSum;

  if (unspecifiedJobTypes.length > ZERO) {
    // Distribute remainder evenly among unspecified job types
    const evenShare = remainder / unspecifiedJobTypes.length;
    for (const jobTypeId of unspecifiedJobTypes) {
      ratios.set(jobTypeId, evenShare);
    }
  } else if (Math.abs(remainder) > EPSILON) {
    // All job types have specified ratios but they don't sum to 1
    // Normalize to ensure sum = 1
    for (const [jobTypeId, ratio] of ratios) {
      ratios.set(jobTypeId, ratio / specifiedSum);
    }
  }

  // Calculate final total for verification
  let totalRatio = ZERO;
  for (const ratio of ratios.values()) {
    totalRatio += ratio;
  }

  return { ratios, totalRatio };
};

/**
 * Validates that the calculated ratios sum to 1 within epsilon.
 * This is a sanity check after calculation.
 * @throws Error if ratios don't sum to 1
 */
export const validateCalculatedRatios = (calculated: CalculatedRatios): void => {
  if (Math.abs(calculated.totalRatio - ONE) > EPSILON) {
    throw new Error(
      `Internal error: calculated ratios don't sum to 1. ` +
        `Got: ${calculated.totalRatio.toFixed(HIGH_PRECISION_DIGITS)}. ` +
        `This indicates a bug in the ratio calculation logic.`
    );
  }
};

/**
 * Validates that a job type ID exists in the configuration.
 * @throws Error if job type is unknown
 */
export const validateJobTypeExists = (jobTypeId: string, resourcesPerJob: ResourcesPerJob): void => {
  if (!(jobTypeId in resourcesPerJob)) {
    const validJobTypes = Object.keys(resourcesPerJob).join(', ');
    throw new Error(`Unknown job type '${jobTypeId}'. Valid job types are: ${validJobTypes}`);
  }
};
