/**
 * Redis distributed backend implementation with fair slot distribution.
 */
import { Redis as RedisClient, type Redis as RedisType } from 'ioredis';

import type {
  AllocationCallback,
  AllocationInfo,
  BackendAcquireContextV2,
  BackendReleaseContextV2,
  DistributedBackendConfig,
  Unsubscribe,
} from '@llm-rate-limiter/core';
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
import type {
  AllocationData,
  RedisBackendConfig,
  RedisBackendInstance,
  RedisBackendStats,
} from './types.js';
import { isRedisClient, subscriberOptions, toRedisOptions } from './types.js';

/** No-op function for ignored promise rejections */
const ignoreError = (): void => {
  // Intentionally empty - used for fire-and-forget operations
};

/** Type guard helper - checks if value is a non-null object */
const isObject = (data: unknown): data is Record<string, unknown> =>
  typeof data === 'object' && data !== null;

/** Type guard for AllocationData */
const isAllocationData = (data: unknown): data is AllocationData => {
  if (!isObject(data)) return false;
  return 'slots' in data && typeof data.slots === 'number';
};

/** Type guard for parsed message */
const isParsedMessage = (data: unknown): data is { instanceId: string; allocation: string } => {
  if (!isObject(data)) return false;
  return 'instanceId' in data && typeof data.instanceId === 'string';
};

/** Type guard for RedisBackendStats */
const isRedisBackendStats = (data: unknown): data is RedisBackendStats => {
  if (!isObject(data)) return false;
  return 'totalInstances' in data;
};

/** Parse allocation data from JSON string with type safety */
const parseAllocation = (json: string | null): AllocationInfo => {
  if (json === null) {
    return { slots: ZERO, tokensPerMinute: ZERO, requestsPerMinute: ZERO };
  }
  const parsed: unknown = JSON.parse(json);
  if (!isAllocationData(parsed)) {
    return { slots: ZERO, tokensPerMinute: ZERO, requestsPerMinute: ZERO };
  }
  return { slots: parsed.slots, tokensPerMinute: parsed.tokensPerMinute, requestsPerMinute: parsed.requestsPerMinute };
};

/** Execute a Lua script via EVAL and return string result */
const evalScript = async (
  redis: RedisType,
  script: string,
  keys: string[],
  args: string[]
): Promise<string> => {
  const result: unknown = await redis.eval(script, keys.length, ...keys, ...args);
  return typeof result === 'string' ? result : '';
};

/** Redis keys structure */
interface RedisKeys {
  instances: string;
  allocations: string;
  config: string;
  channel: string;
}

/** Build Redis keys with prefix */
const buildKeys = (prefix: string): RedisKeys => ({
  instances: `${prefix}${KEY_SUFFIX_INSTANCES}`,
  allocations: `${prefix}${KEY_SUFFIX_ALLOCATIONS}`,
  config: `${prefix}${KEY_SUFFIX_CONFIG}`,
  channel: `${prefix}${KEY_SUFFIX_CHANNEL}`,
});

/** Configuration for backend operations */
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
    this.redis = isRedisClient(redisConfig.redis) ? redisConfig.redis : new RedisClient(toRedisOptions(redisConfig.redis));
    this.subscriber = this.redis.duplicate(subscriberOptions);
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
      evalScript(redis, CLEANUP_SCRIPT, [instances, allocations, configKey, channel], [String(cutoff)]).catch(ignoreError);
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
      // Wait for subscriber to be ready if not connected yet
      if (this.subscriber.status !== 'ready' && this.subscriber.status !== 'connect') {
        await new Promise<void>((resolve, reject) => {
          const onReady = (): void => {
            this.subscriber.off('error', onError);
            resolve();
          };
          const onError = (err: Error): void => {
            this.subscriber.off('ready', onReady);
            reject(err);
          };
          this.subscriber.once('ready', onReady);
          this.subscriber.once('error', onError);
        });
      }
      await this.subscriber.subscribe(this.keys.channel);
      this.subscriberActive = true;
      this.subscriber.on('message', this.handleMessage.bind(this));
    } catch {
      // Subscription failed - system continues without real-time updates
      // Allocations will still be fetched on register/acquire operations
    }
  }

  private handleMessage(_channel: string, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
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
      [instanceId, String(Date.now()), String(totalCapacity), String(tokensPerMinute), String(requestsPerMinute)]
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
      return false;
    }
  };

  readonly release = async (context: BackendReleaseContextV2): Promise<void> => {
    const { keys, redis } = this;
    const { instances, allocations, config: configKey, channel } = keys;
    await evalScript(redis, RELEASE_SCRIPT, [instances, allocations, configKey, channel], [context.instanceId, String(Date.now())]);
  };

  readonly subscribe = (instanceId: string, callback: AllocationCallback): Unsubscribe => {
    this.subscriptions.set(instanceId, callback);
    void this.setupSubscriber();
    void this.fetchAndCallbackAllocation(instanceId, callback);
    return () => { this.subscriptions.delete(instanceId); };
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
