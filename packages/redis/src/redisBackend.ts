/**
 * Redis distributed backend implementation with multi-dimensional slot distribution.
 */
import type {
  AllocationCallback,
  AllocationInfo,
  BackendAcquireContext,
  BackendConfig,
  BackendReleaseContext,
  Unsubscribe,
} from '@llm-rate-limiter/core';
import { Redis as RedisClient, type Redis as RedisType } from 'ioredis';
import { once } from 'node:events';

import {
  DEFAULT_CLEANUP_INTERVAL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_INSTANCE_TIMEOUT_MS,
  DEFAULT_KEY_PREFIX,
  SUCCESS_RESULT,
  ZERO,
} from './constants.js';
import {
  ACQUIRE_SCRIPT,
  CLEANUP_SCRIPT,
  GET_STATS_SCRIPT,
  HEARTBEAT_SCRIPT,
  INIT_CONFIG_SCRIPT,
  REGISTER_SCRIPT,
  RELEASE_SCRIPT,
  UNREGISTER_SCRIPT,
} from './luaScripts.js';
import type { BackendOperationConfig, RedisKeys } from './redisHelpers.js';
import { buildKeys, evalScript } from './redisHelpers.js';
import { ignoreError, isParsedMessage, isRedisBackendStats, parseAllocation } from './redisTypeGuards.js';
import type { RedisBackendInstance, RedisBackendInternalConfig, RedisBackendStats } from './types.js';
import { isRedisClient, subscriberOptions, toRedisOptions } from './types.js';

/** Internal backend implementation class */
class RedisBackendImpl {
  private readonly redis: RedisType;
  private readonly subscriber: RedisType;
  private readonly keys: RedisKeys;
  private readonly config: BackendOperationConfig;
  private readonly ownClient: boolean;
  private readonly subscriptions = new Map<string, AllocationCallback>();
  private readonly registeredInstances = new Set<string>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private subscriberActive = false;
  private setupSubscriberPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private configInitPromise: Promise<void> | null = null;

  constructor(redisConfig: RedisBackendInternalConfig) {
    this.ownClient = !isRedisClient(redisConfig.redis);
    this.redis = isRedisClient(redisConfig.redis)
      ? redisConfig.redis
      : new RedisClient(toRedisOptions(redisConfig.redis));
    this.subscriber = this.redis.duplicate(subscriberOptions);
    /* istanbul ignore next -- Tests always provide keyPrefix */
    this.keys = buildKeys(redisConfig.keyPrefix ?? DEFAULT_KEY_PREFIX);
    this.config = {
      totalCapacity: redisConfig.totalCapacity,
      tokensPerMinute: redisConfig.tokensPerMinute,
      requestsPerMinute: redisConfig.requestsPerMinute,
      heartbeatIntervalMs: redisConfig.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      instanceTimeoutMs: redisConfig.instanceTimeoutMs ?? DEFAULT_INSTANCE_TIMEOUT_MS,
      resourceEstimationsPerJob: redisConfig.resourceEstimationsPerJob,
    };
    this.setupSubscriberReconnection();
    this.startCleanupInterval();
    // Initialize config in Redis
    this.configInitPromise = this.initConfig(
      redisConfig.modelCapacities,
      redisConfig.resourceEstimationsPerJob
    );
  }

  /** Initialize config in Redis (model capacities and job type resources) */
  private async initConfig(
    modelCapacities: RedisBackendInternalConfig['modelCapacities'],
    resourceEstimationsPerJob: RedisBackendInternalConfig['resourceEstimationsPerJob']
  ): Promise<void> {
    if (modelCapacities === undefined || resourceEstimationsPerJob === undefined) return;
    const { keys, redis } = this;
    // Build job type resources with ratios
    const jobTypeResources: Record<string, { estimatedUsedTokens: number; estimatedNumberOfRequests: number; ratio: number }> = {};
    const jobTypeIds = Object.keys(resourceEstimationsPerJob);
    let specifiedTotal = 0;
    const specifiedRatios = new Map<string, number>();
    for (const id of jobTypeIds) {
      const config = resourceEstimationsPerJob[id];
      if (config?.ratio?.initialValue !== undefined) {
        specifiedRatios.set(id, config.ratio.initialValue);
        specifiedTotal += config.ratio.initialValue;
      }
    }
    const remainingRatio = 1 - specifiedTotal;
    const unspecifiedCount = jobTypeIds.length - specifiedRatios.size;
    const evenShare = unspecifiedCount > 0 ? remainingRatio / unspecifiedCount : 0;
    for (const id of jobTypeIds) {
      const config = resourceEstimationsPerJob[id];
      jobTypeResources[id] = {
        estimatedUsedTokens: config?.estimatedUsedTokens ?? 1,
        estimatedNumberOfRequests: config?.estimatedNumberOfRequests ?? 1,
        ratio: specifiedRatios.get(id) ?? evenShare,
      };
    }
    await evalScript(
      redis,
      INIT_CONFIG_SCRIPT,
      [keys.modelCapacities, keys.jobTypeResources],
      [JSON.stringify(modelCapacities), JSON.stringify(jobTypeResources)]
    );
  }

  private setupSubscriberReconnection(): void {
    this.subscriber.on('error', ignoreError);
    this.subscriber.on('reconnecting', ignoreError);
    this.subscriber.on('ready', () => {
      // Resubscribe after reconnection if we were subscribed
      if (this.subscriberActive && this.subscriptions.size > ZERO) {
        this.subscriber.subscribe(this.keys.channel).catch(ignoreError);
      }
    });
  }

  private startCleanupInterval(): void {
    const { config, keys, redis } = this;
    const { instanceTimeoutMs } = config;
    const { instances, allocations, channel, modelCapacities, jobTypeResources } = keys;
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - instanceTimeoutMs;
      evalScript(
        redis,
        CLEANUP_SCRIPT,
        [instances, allocations, channel, modelCapacities, jobTypeResources],
        [String(cutoff)]
      ).catch(ignoreError);
    }, DEFAULT_CLEANUP_INTERVAL_MS);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval !== null) return;
    const { config, keys, redis, registeredInstances } = this;
    const { heartbeatIntervalMs } = config;
    const { instances } = keys;
    this.heartbeatInterval = setInterval(() => {
      const now = String(Date.now());
      for (const instId of registeredInstances) {
        evalScript(redis, HEARTBEAT_SCRIPT, [instances], [instId, now]).catch(ignoreError);
      }
    }, heartbeatIntervalMs);
  }

  private async setupSubscriber(): Promise<void> {
    if (this.subscriberActive) return;
    if (this.setupSubscriberPromise !== null) {
      await this.setupSubscriberPromise;
      return;
    }
    this.setupSubscriberPromise = this.performSetupSubscriber();
    await this.setupSubscriberPromise;
  }

  private async performSetupSubscriber(): Promise<void> {
    try {
      if (this.subscriber.status !== 'ready' && this.subscriber.status !== 'connect') {
        await once(this.subscriber, 'ready');
      }
      await this.subscriber.subscribe(this.keys.channel);
      this.subscriberActive = true;
      this.subscriber.on('message', this.handleMessage.bind(this));
    } catch {
      // Subscription failed - continues without real-time updates
    }
  }

  private handleMessage(_channel: string, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
      /* istanbul ignore if -- Defensive: Lua script sends valid messages */
      if (!isParsedMessage(parsed)) return;
      const callback = this.subscriptions.get(parsed.instanceId);
      if (callback !== undefined) {
        const allocation = parseAllocation(parsed.allocation);
        callback(allocation);
      }
    } catch {
      // Ignore parse errors
    }
  }

  readonly register = async (instanceId: string): Promise<AllocationInfo> => {
    const { keys, redis } = this;
    const { instances, allocations, channel, modelCapacities, jobTypeResources } = keys;
    // Wait for config init if in progress
    if (this.configInitPromise !== null) {
      await this.configInitPromise;
    }
    const result = await evalScript(
      redis,
      REGISTER_SCRIPT,
      [instances, allocations, channel, modelCapacities, jobTypeResources],
      [instanceId, String(Date.now())]
    );
    this.registeredInstances.add(instanceId);
    this.startHeartbeat();
    return parseAllocation(result);
  };

  readonly unregister = async (instanceId: string): Promise<void> => {
    this.registeredInstances.delete(instanceId);
    this.subscriptions.delete(instanceId);
    const { keys, redis } = this;
    const { instances, allocations, channel, modelCapacities, jobTypeResources } = keys;
    await evalScript(
      redis,
      UNREGISTER_SCRIPT,
      [instances, allocations, channel, modelCapacities, jobTypeResources],
      [instanceId]
    );
  };

  readonly acquire = async (context: BackendAcquireContext): Promise<boolean> => {
    const { keys, redis } = this;
    const { instances, allocations } = keys;
    try {
      // Pool-based: only pass modelId (no jobType - that's handled locally)
      const result = await evalScript(
        redis,
        ACQUIRE_SCRIPT,
        [instances, allocations],
        [context.instanceId, String(Date.now()), context.modelId]
      );
      return result === SUCCESS_RESULT;
    } catch {
      /* istanbul ignore next -- Defensive: Redis connection error during acquire */
      return false;
    }
  };

  readonly release = async (context: BackendReleaseContext): Promise<void> => {
    const { keys, redis } = this;
    const { instances, allocations, channel, modelCapacities, jobTypeResources } = keys;
    const windowStarts = context.windowStarts ?? {};
    // Pool-based: no jobType parameter (that's handled locally)
    await evalScript(
      redis,
      RELEASE_SCRIPT,
      [instances, allocations, channel, modelCapacities, jobTypeResources],
      [
        context.instanceId,
        String(Date.now()),
        context.modelId,
        String(context.actual.tokens),
        String(context.actual.requests),
        String(windowStarts.tpmWindowStart ?? ''),
        String(windowStarts.rpmWindowStart ?? ''),
        String(windowStarts.tpdWindowStart ?? ''),
        String(windowStarts.rpdWindowStart ?? ''),
      ]
    );
  };

  readonly subscribe = (instanceId: string, callback: AllocationCallback): Unsubscribe => {
    this.subscriptions.set(instanceId, callback);
    // Setup subscriber and fetch allocation - both async but we track them
    this.setupSubscriber().catch(ignoreError);
    this.fetchAndCallbackAllocation(instanceId, callback).catch(ignoreError);
    return () => {
      this.subscriptions.delete(instanceId);
    };
  };

  private async fetchAndCallbackAllocation(instanceId: string, callback: AllocationCallback): Promise<void> {
    try {
      const allocJson = await this.redis.hget(this.keys.allocations, instanceId);
      callback(parseAllocation(allocJson));
    } catch {
      // Ignore, callback will be called on next update
    }
  }

  readonly stop = async (): Promise<void> => {
    // If already stopping or stopped, await the existing promise
    if (this.stopPromise !== null) {
      await this.stopPromise;
      return;
    }

    this.stopPromise = this.performStop();
    await this.stopPromise;
  };

  private async performStop(): Promise<void> {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    /* istanbul ignore if -- cleanupInterval always set in constructor */
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.subscriberActive) {
      await this.subscriber.unsubscribe(this.keys.channel);
      this.subscriberActive = false;
    }
    // Use quit() for graceful shutdown - waits for pending commands
    await this.subscriber.quit();
    if (this.ownClient) {
      await this.redis.quit();
    }
  }

  readonly getStats = async (): Promise<RedisBackendStats> => {
    const { keys, redis } = this;
    const { instances, allocations } = keys;
    const result = await evalScript(redis, GET_STATS_SCRIPT, [instances, allocations], []);
    const parsed: unknown = JSON.parse(result);
    /* istanbul ignore if -- Defensive: Lua script always returns valid stats */
    if (!isRedisBackendStats(parsed)) {
      return { totalInstances: ZERO, totalInFlight: ZERO, totalAllocated: ZERO, instances: [] };
    }
    return parsed;
  };

  getBackendConfig(): BackendConfig {
    return {
      register: this.register,
      unregister: this.unregister,
      acquire: this.acquire,
      release: this.release,
      subscribe: this.subscribe,
    };
  }
}

/** Create a Redis distributed backend instance. */
export const createRedisBackend = (config: RedisBackendInternalConfig): RedisBackendInstance => {
  const impl = new RedisBackendImpl(config);
  return {
    getBackendConfig: () => impl.getBackendConfig(),
    stop: impl.stop,
    getStats: impl.getStats,
  };
};
