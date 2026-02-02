/**
 * Redis distributed backend implementation with fair slot distribution.
 */
import type {
  AllocationCallback,
  AllocationInfo,
  BackendAcquireContextV2,
  BackendReleaseContextV2,
  DistributedBackendConfig,
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
  REGISTER_SCRIPT,
  RELEASE_SCRIPT,
  UNREGISTER_SCRIPT,
} from './luaScripts.js';
import type { BackendOperationConfig, RedisKeys } from './redisHelpers.js';
import { buildKeys, evalScript } from './redisHelpers.js';
import { RedisJobTypeOps } from './redisJobTypeOps.js';
import { ignoreError, isParsedMessage, isRedisBackendStats, parseAllocation } from './redisTypeGuards.js';
import type {
  RedisBackendConfig,
  RedisBackendInstance,
  RedisBackendStats,
  RedisJobTypeStats,
} from './types.js';
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
  private readonly jobTypeOps: RedisJobTypeOps;

  constructor(redisConfig: RedisBackendConfig) {
    this.ownClient = !isRedisClient(redisConfig.redis);
    this.redis = isRedisClient(redisConfig.redis)
      ? redisConfig.redis
      : new RedisClient(toRedisOptions(redisConfig.redis));
    this.subscriber = this.redis.duplicate(subscriberOptions);
    /* istanbul ignore next -- Tests always provide keyPrefix */
    this.keys = buildKeys(redisConfig.keyPrefix ?? DEFAULT_KEY_PREFIX);
    this.config = {
      totalCapacity: redisConfig.totalCapacity,
      tokensPerMinute: redisConfig.tokensPerMinute ?? ZERO,
      requestsPerMinute: redisConfig.requestsPerMinute ?? ZERO,
      heartbeatIntervalMs: redisConfig.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      instanceTimeoutMs: redisConfig.instanceTimeoutMs ?? DEFAULT_INSTANCE_TIMEOUT_MS,
      resourcesPerJob: redisConfig.resourcesPerJob,
    };
    this.setupSubscriberReconnection();
    this.startCleanupInterval();
    this.jobTypeOps = new RedisJobTypeOps(
      this.redis,
      this.keys,
      redisConfig.resourcesPerJob,
      redisConfig.totalCapacity
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
    const { instances, allocations, config: configKey, channel } = keys;
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - instanceTimeoutMs;
      evalScript(redis, CLEANUP_SCRIPT, [instances, allocations, configKey, channel], [String(cutoff)]).catch(
        ignoreError
      );
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
        callback(parseAllocation(parsed.allocation));
      }
    } catch {
      // Ignore parse errors
    }
  }

  readonly register = async (instanceId: string): Promise<AllocationInfo> => {
    const { keys, config, redis } = this;
    const { instances, allocations, config: configKey, channel } = keys;
    const { totalCapacity, tokensPerMinute, requestsPerMinute } = config;
    const result = await evalScript(
      redis,
      REGISTER_SCRIPT,
      [instances, allocations, configKey, channel],
      [
        instanceId,
        String(Date.now()),
        String(totalCapacity),
        String(tokensPerMinute),
        String(requestsPerMinute),
      ]
    );
    this.registeredInstances.add(instanceId);
    this.startHeartbeat();
    return parseAllocation(result);
  };

  readonly unregister = async (instanceId: string): Promise<void> => {
    this.registeredInstances.delete(instanceId);
    this.subscriptions.delete(instanceId);
    const { keys, redis } = this;
    const { instances, allocations, config: configKey, channel } = keys;
    await evalScript(redis, UNREGISTER_SCRIPT, [instances, allocations, configKey, channel], [instanceId]);
  };

  readonly acquire = async (context: BackendAcquireContextV2): Promise<boolean> => {
    const { keys, redis } = this;
    const { instances, allocations } = keys;
    try {
      const result = await evalScript(
        redis,
        ACQUIRE_SCRIPT,
        [instances, allocations],
        [context.instanceId, String(Date.now())]
      );
      return result === SUCCESS_RESULT;
    } catch {
      /* istanbul ignore next -- Defensive: Redis connection error during acquire */
      return false;
    }
  };

  readonly release = async (context: BackendReleaseContextV2): Promise<void> => {
    const { keys, redis } = this;
    const { instances, allocations, config: configKey, channel } = keys;
    await evalScript(
      redis,
      RELEASE_SCRIPT,
      [instances, allocations, configKey, channel],
      [context.instanceId, String(Date.now())]
    );
  };

  readonly subscribe = (instanceId: string, callback: AllocationCallback): Unsubscribe => {
    this.subscriptions.set(instanceId, callback);
    void this.setupSubscriber();
    void this.fetchAndCallbackAllocation(instanceId, callback);
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
    this.subscriber.disconnect();
    if (this.ownClient) {
      this.redis.disconnect();
    }
  };

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

  readonly acquireJobType = async (instanceId: string, jobTypeId: string): Promise<boolean> =>
    await this.jobTypeOps.acquire(instanceId, jobTypeId);

  readonly releaseJobType = async (instanceId: string, jobTypeId: string): Promise<void> => {
    await this.jobTypeOps.release(instanceId, jobTypeId);
  };

  readonly getJobTypeStats = async (): Promise<RedisJobTypeStats | undefined> =>
    await this.jobTypeOps.getStats();

  getBackendConfig(): DistributedBackendConfig {
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
export const createRedisBackend = (config: RedisBackendConfig): RedisBackendInstance => {
  const impl = new RedisBackendImpl(config);
  return {
    getBackendConfig: () => impl.getBackendConfig(),
    stop: impl.stop,
    getStats: impl.getStats,
    getJobTypeStats: impl.getJobTypeStats,
    acquireJobType: impl.acquireJobType,
    releaseJobType: impl.releaseJobType,
  };
};
