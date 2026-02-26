/**
 * Transform raw collected data into the improved structure.
 */
import type { JobTypeState, ModelPoolAllocation } from '@llm-rate-limiter/core';
import type { JobTypeResourceEstimate, ModelCapacity, TestData } from '@llm-rate-limiter/e2e-test-results';

import { buildJobRecords } from './testDataTransformJobs.js';
import { buildSnapshots } from './testDataTransformState.js';
import { buildSummary } from './testDataTransformSummary.js';
import { buildTimeline } from './testDataTransformTimeline.js';
import type { RawEvent, RawSnapshot, RawTestData } from './testDataTransformTypes.js';

// Re-export types
export type { RawTestData } from './testDataTransformTypes.js';

/**
 * Extract instance ID mapping from SSE events
 */
const buildMappingFromEvents = (events: RawEvent[]): Record<string, string> => {
  const mapping: Record<string, string> = {};
  for (const {
    sourceUrl,
    event: { instanceId },
  } of events) {
    mapping[sourceUrl] = instanceId;
  }
  return mapping;
};

/**
 * Collect unique instance IDs from snapshots in discovery order
 */
const collectUniqueInstanceIds = (snapshots: RawSnapshot[]): string[] => {
  const allInstances = snapshots.flatMap((s) => s.instances);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const inst of allInstances) {
    if (!seen.has(inst.instanceId)) {
      seen.add(inst.instanceId);
      ids.push(inst.instanceId);
    }
  }
  return ids;
};

/**
 * Discover instances from snapshots that weren't found via SSE events.
 * Pairs unmapped instance IDs with unmapped URLs in order.
 */
const discoverFromSnapshots = (
  existing: Record<string, string>,
  instanceUrls: string[],
  snapshots: RawSnapshot[]
): Record<string, string> => {
  const mappedIds = new Set(Object.values(existing));
  const unmappedUrls = instanceUrls.filter((url) => !(url in existing));
  const unmappedIds = collectUniqueInstanceIds(snapshots).filter((id) => !mappedIds.has(id));

  const result: Record<string, string> = { ...existing };
  const idIterator = unmappedIds.values();
  for (const url of unmappedUrls) {
    const { value: instanceId, done } = idIterator.next();
    if (done === true) break;
    result[url] = instanceId;
  }
  return result;
};

const ZERO = 0;
const DEFAULT_ESTIMATED_TOKENS = 0;
const DEFAULT_ESTIMATED_REQUESTS = 1;

/** Build optional maxConcurrentRequests fragment for spread */
const concurrentFragment = (concurrent: number | undefined): Pick<ModelCapacity, 'maxConcurrentRequests'> =>
  concurrent !== undefined && concurrent > ZERO ? { maxConcurrentRequests: concurrent } : {};

/** Convert pool allocations to ModelCapacity map */
const poolToCapacity = (pools: Record<string, ModelPoolAllocation>): Record<string, ModelCapacity> => {
  const result: Record<string, ModelCapacity> = {};
  for (const [modelId, pool] of Object.entries(pools)) {
    result[modelId] = {
      totalSlots: pool.totalSlots,
      tokensPerMinute: pool.tokensPerMinute,
      requestsPerMinute: pool.requestsPerMinute,
      tokensPerDay: pool.tokensPerDay,
      requestsPerDay: pool.requestsPerDay,
      ...concurrentFragment(pool.maxConcurrentRequests),
    };
  }
  return result;
};

/** Find first instance with allocation pools across all snapshots */
const findFirstAllocation = (snapshots: RawSnapshot[]): Record<string, ModelCapacity> | undefined => {
  const instances = snapshots.flatMap((s) => s.instances);
  const allocated = instances.find((inst) => inst.allocation?.pools !== undefined);
  return allocated?.allocation?.pools === undefined ? undefined : poolToCapacity(allocated.allocation.pools);
};

/** Convert job type stats map to resource estimates */
const jobTypesToResources = (
  jobTypes: Record<string, JobTypeState>
): Record<string, JobTypeResourceEstimate> => {
  const result: Record<string, JobTypeResourceEstimate> = {};
  for (const [jtId, state] of Object.entries(jobTypes)) {
    result[jtId] = {
      estimatedUsedTokens: state.resources.estimatedUsedTokens ?? DEFAULT_ESTIMATED_TOKENS,
      estimatedNumberOfRequests: state.resources.estimatedNumberOfRequests ?? DEFAULT_ESTIMATED_REQUESTS,
    };
  }
  return result;
};

/** Find first instance with job type stats across all snapshots */
const findFirstJobTypeResources = (
  snapshots: RawSnapshot[]
): Record<string, JobTypeResourceEstimate> | undefined => {
  const instances = snapshots.flatMap((s) => s.instances);
  const withJt = instances.find((inst) => inst.stats.jobTypes?.jobTypes !== undefined);
  return withJt?.stats.jobTypes?.jobTypes === undefined
    ? undefined
    : jobTypesToResources(withJt.stats.jobTypes.jobTypes);
};

/**
 * Main transform function
 */
export const transformTestData = (raw: RawTestData): TestData => {
  const instanceMapping = discoverFromSnapshots(
    buildMappingFromEvents(raw.events),
    raw.instanceUrls,
    raw.snapshots
  );
  const jobs = buildJobRecords(raw.jobsSent, raw.events);
  const timeline = buildTimeline(raw.events);
  const snapshots = buildSnapshots(raw.snapshots);
  const summary = buildSummary(jobs);
  const modelCapacities = findFirstAllocation(raw.snapshots);
  const jobTypeResources = findFirstJobTypeResources(raw.snapshots);

  return {
    metadata: {
      startTime: raw.startTime,
      endTime: raw.endTime,
      durationMs: raw.endTime - raw.startTime,
      instances: instanceMapping,
      modelCapacities,
      jobTypeResources,
    },
    jobs,
    timeline,
    snapshots,
    summary,
  };
};
