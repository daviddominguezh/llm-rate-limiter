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
  KEY_SUFFIX_ALLOCATIONS,
  KEY_SUFFIX_CHANNEL,
  KEY_SUFFIX_CONFIG,
  KEY_SUFFIX_INSTANCES,
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
import type { AllocationData, RedisBackendConfig, RedisBackendInstance, RedisBackendStats } from './types.js';
import { isRedisClient, subscriberOptions, toRedisOptions } from './types.js';

const ignoreError = (): void => {
  /* fire-and-forget */
};
const isObject = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null;
const isAllocationData = (d: unknown): d is AllocationData =>
  isObject(d) && 'slots' in d && typeof d.slots === 'number';
const isParsedMessage = (d: unknown): d is { instanceId: string; allocation: string } =>
  isObject(d) && 'instanceId' in d && typeof d.instanceId === 'string';
const isRedisBackendStats = (d: unknown): d is RedisBackendStats => isObject(d) && 'totalInstances' in d;
const defaultAlloc: AllocationInfo = { slots: ZERO, tokensPerMinute: ZERO, requestsPerMinute: ZERO };
const parseAllocation = (json: string | null): AllocationInfo => {
  /* istanbul ignore if -- Defensive: allocation data should exist */
  if (json === null) return defaultAlloc;
  const parsed: unknown = JSON.parse(json);
  /* istanbul ignore if -- Defensive: Lua script returns valid allocation */
  if (!isAllocationData(parsed)) return defaultAlloc;
  return {
    slots: parsed.slots,
    tokensPerMinute: parsed.tokensPerMinute,
    requestsPerMinute: parsed.requestsPerMinute,
  };
};
const evalScript = async (
  redis: RedisType,
  script: string,
  keys: string[],
  args: string[]
): Promise<string> => {
  const result: unknown = await redis.eval(script, keys.length, ...keys, ...args);
  return typeof result === 'string' ? result : '';
};
interface RedisKeys {
  instances: string;
  allocations: string;
  config: string;
  channel: string;
}
const buildKeys = (prefix: string): RedisKeys => ({
  instances: `${prefix}${KEY_SUFFIX_INSTANCES}`,
  allocations: `${prefix}${KEY_SUFFIX_ALLOCATIONS}`,
  config: `${prefix}${KEY_SUFFIX_CONFIG}`,
  channel: `${prefix}${KEY_SUFFIX_CHANNEL}`,
});
interface BackendOperationConfig {
  totalCapacity: number;
  tokensPerMinute: number;
  requestsPerMinute: number;
  heartbeatIntervalMs: number;
  instanceTimeoutMs: number;
}

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
    };
    this.setupSubscriberReconnection();
    this.startCleanupInterval();
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

/**
 * Create a Redis distributed backend instance.
 *
 * @param config - Redis backend configuration
 * @returns The backend instance
 */
export const createRedisBackend = (config: RedisBackendConfig): RedisBackendInstance => {
  const impl = new RedisBackendImpl(config);
  return {
    getBackendConfig: () => impl.getBackendConfig(),
    stop: impl.stop,
    getStats: impl.getStats,
  };
};
