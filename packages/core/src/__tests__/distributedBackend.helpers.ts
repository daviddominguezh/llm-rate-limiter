/**
 * Dummy distributed backend for testing multi-instance rate limiting.
 * Simulates Redis-like centralized state with pub/sub notifications.
 */
import type {
  AllocationCallback,
  AllocationInfo,
  BackendAcquireContext,
  BackendConfig,
  BackendReleaseContext,
  DistributedAvailability,
  LLMRateLimiterInstance,
  Unsubscribe,
} from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;
const MS_PER_MINUTE = 60_000;

/** Subscriber callback type */
export type AvailabilitySubscriber = (availability: DistributedAvailability) => void;

/** Tracked usage per model */
interface ModelUsage {
  tokensPerMinute: number;
  requestsPerMinute: number;
  lastResetTime: number;
}

/** Configuration for the distributed backend */
export interface DistributedBackendConfig {
  tokensPerMinute: number;
  requestsPerMinute: number;
  estimatedTokensPerRequest: number;
}

/** Statistics for monitoring the distributed backend */
export interface DistributedBackendStats {
  totalAcquires: number;
  totalReleases: number;
  totalTokensUsed: number;
  totalRequestsUsed: number;
  peakTokensPerMinute: number;
  peakRequestsPerMinute: number;
  rejections: number;
}

/** Return type for createDistributedBackend */
export interface DistributedBackendInstance {
  backend: BackendConfig;
  subscribe: (callback: AvailabilitySubscriber) => () => void;
  getAvailability: () => DistributedAvailability;
  getStats: () => DistributedBackendStats;
  reset: () => void;
  advanceTime: (ms: number) => void;
  getCurrentTime: () => number;
}

const createInitialStats = (): DistributedBackendStats => ({
  totalAcquires: ZERO,
  totalReleases: ZERO,
  totalTokensUsed: ZERO,
  totalRequestsUsed: ZERO,
  peakTokensPerMinute: ZERO,
  peakRequestsPerMinute: ZERO,
  rejections: ZERO,
});

const createUsageHelpers = (
  modelUsage: Map<string, ModelUsage>,
  getCurrentTime: () => number
): {
  getOrCreate: (modelId: string) => ModelUsage;
  resetIfNeeded: (modelId: string) => void;
  getTotal: () => { tokens: number; requests: number };
} => ({
  getOrCreate: (modelId: string): ModelUsage => {
    let usage = modelUsage.get(modelId);
    if (usage === undefined) {
      usage = { tokensPerMinute: ZERO, requestsPerMinute: ZERO, lastResetTime: getCurrentTime() };
      modelUsage.set(modelId, usage);
    }
    return usage;
  },
  resetIfNeeded: (modelId: string): void => {
    const usage = modelUsage.get(modelId);
    if (usage !== undefined && getCurrentTime() - usage.lastResetTime >= MS_PER_MINUTE) {
      modelUsage.set(modelId, {
        tokensPerMinute: ZERO,
        requestsPerMinute: ZERO,
        lastResetTime: getCurrentTime(),
      });
    }
  },
  getTotal: (): { tokens: number; requests: number } => {
    let tokens = ZERO;
    let requests = ZERO;
    for (const [id] of modelUsage) {
      const u = modelUsage.get(id);
      if (u !== undefined) {
        tokens += u.tokensPerMinute;
        requests += u.requestsPerMinute;
      }
    }
    return { tokens, requests };
  },
});

const createAvailabilityCalc =
  (
    config: DistributedBackendConfig,
    getTotal: () => { tokens: number; requests: number }
  ): (() => DistributedAvailability) =>
  (): DistributedAvailability => {
    const { tokens, requests } = getTotal();
    const availableTokens = Math.max(ZERO, config.tokensPerMinute - tokens);
    const availableRequests = Math.max(ZERO, config.requestsPerMinute - requests);
    const slotsByTokens = Math.floor(availableTokens / config.estimatedTokensPerRequest);
    return {
      slots: Math.min(slotsByTokens, availableRequests),
      tokensPerMinute: availableTokens,
      requestsPerMinute: availableRequests,
    };
  };

const checkCapacity = (
  ctx: BackendAcquireContext,
  config: DistributedBackendConfig,
  totalT: number,
  totalR: number
): boolean =>
  totalT + ctx.estimated.tokens <= config.tokensPerMinute &&
  totalR + ctx.estimated.requests <= config.requestsPerMinute;

const createNotify =
  (subscribers: Set<AvailabilitySubscriber>, calcAvail: () => DistributedAvailability): (() => void) =>
  (): void => {
    const avail = calcAvail();
    for (const sub of subscribers) sub(avail);
  };

class BackendStateManager {
  stats: DistributedBackendStats;
  currentTime: number;
  constructor() {
    this.stats = createInitialStats();
    this.currentTime = Date.now();
  }
  reject(): void {
    this.stats.rejections += ONE;
  }
  recordAcquire(tokens: number, requests: number, peakT: number, peakR: number): void {
    this.stats.totalAcquires += ONE;
    this.stats.totalTokensUsed += tokens;
    this.stats.totalRequestsUsed += requests;
    this.stats.peakTokensPerMinute = Math.max(this.stats.peakTokensPerMinute, peakT);
    this.stats.peakRequestsPerMinute = Math.max(this.stats.peakRequestsPerMinute, peakR);
  }
  recordRelease(): void {
    this.stats.totalReleases += ONE;
  }
  reset(): void {
    this.stats = createInitialStats();
  }
  advanceTime(ms: number): void {
    this.currentTime += ms;
  }
  getTime(): number {
    return this.currentTime;
  }
  getStats(): DistributedBackendStats {
    return { ...this.stats };
  }
}

type UsageHelpers = ReturnType<typeof createUsageHelpers>;

const createAcquireFn =
  (
    config: DistributedBackendConfig,
    usage: UsageHelpers,
    state: BackendStateManager,
    notify: () => void
  ): ((ctx: BackendAcquireContext) => boolean) =>
  (ctx: BackendAcquireContext): boolean => {
    const u = usage.getOrCreate(ctx.modelId);
    usage.resetIfNeeded(ctx.modelId);
    const { tokens: totalT, requests: totalR } = usage.getTotal();
    if (!checkCapacity(ctx, config, totalT, totalR)) {
      state.reject();
      return false;
    }
    u.tokensPerMinute += ctx.estimated.tokens;
    u.requestsPerMinute += ctx.estimated.requests;
    const { tokens: newT, requests: newR } = usage.getTotal();
    state.recordAcquire(ctx.estimated.tokens, ctx.estimated.requests, newT, newR);
    notify();
    return true;
  };

const createReleaseFn =
  (
    usage: UsageHelpers,
    state: BackendStateManager,
    notify: () => void
  ): ((ctx: BackendReleaseContext) => void) =>
  (ctx: BackendReleaseContext): void => {
    const u = usage.getOrCreate(ctx.modelId);
    usage.resetIfNeeded(ctx.modelId);
    const tokenDiff = ctx.estimated.tokens - ctx.actual.tokens;
    const requestDiff = ctx.estimated.requests - ctx.actual.requests;
    if (tokenDiff > ZERO) u.tokensPerMinute = Math.max(ZERO, u.tokensPerMinute - tokenDiff);
    if (requestDiff > ZERO) u.requestsPerMinute = Math.max(ZERO, u.requestsPerMinute - requestDiff);
    state.recordRelease();
    notify();
  };

const createSubscribeFn =
  (
    subscribers: Set<AvailabilitySubscriber>,
    calcAvail: () => DistributedAvailability
  ): ((cb: AvailabilitySubscriber) => () => void) =>
  (cb: AvailabilitySubscriber): (() => void) => {
    subscribers.add(cb);
    cb(calcAvail());
    return () => {
      subscribers.delete(cb);
    };
  };

const createAllocationFromAvailability = (avail: DistributedAvailability): AllocationInfo => ({
  slots: avail.slots,
  tokensPerMinute: avail.tokensPerMinute ?? ZERO,
  requestsPerMinute: avail.requestsPerMinute ?? ZERO,
});

const createBackendSubscribeFn =
  (
    instanceSubscribers: Map<string, AllocationCallback>,
    calcAvail: () => DistributedAvailability
  ): ((instanceId: string, callback: AllocationCallback) => Unsubscribe) =>
  (instanceId: string, callback: AllocationCallback): Unsubscribe => {
    instanceSubscribers.set(instanceId, callback);
    callback(createAllocationFromAvailability(calcAvail()));
    return (): void => {
      instanceSubscribers.delete(instanceId);
    };
  };

/** Creates a dummy distributed backend that simulates centralized rate limiting. */
export const createDistributedBackend = (config: DistributedBackendConfig): DistributedBackendInstance => {
  const subscribers = new Set<AvailabilitySubscriber>();
  const instanceSubscribers = new Map<string, AllocationCallback>();
  const modelUsage = new Map<string, ModelUsage>();
  const state = new BackendStateManager();
  const usage = createUsageHelpers(modelUsage, () => state.getTime());
  const calcAvail = createAvailabilityCalc(config, () => {
    for (const [id] of modelUsage) usage.resetIfNeeded(id);
    return usage.getTotal();
  });
  const notify = createNotify(subscribers, calcAvail);
  const doAcquire = createAcquireFn(config, usage, state, notify);
  const doRelease = createReleaseFn(usage, state, notify);
  return {
    backend: {
      register: async (_instanceId: string): Promise<AllocationInfo> =>
        await Promise.resolve(createAllocationFromAvailability(calcAvail())),
      unregister: async (_instanceId: string): Promise<void> => {
        await Promise.resolve();
      },
      acquire: async (ctx): Promise<boolean> => await Promise.resolve(doAcquire(ctx)),
      release: async (ctx): Promise<void> => {
        doRelease(ctx);
        await Promise.resolve();
      },
      subscribe: createBackendSubscribeFn(instanceSubscribers, calcAvail),
    },
    subscribe: createSubscribeFn(subscribers, calcAvail),
    getAvailability: calcAvail,
    getStats: () => state.getStats(),
    reset: () => {
      modelUsage.clear();
      state.reset();
      notify();
    },
    advanceTime: (ms) => {
      state.advanceTime(ms);
      notify();
    },
    getCurrentTime: () => state.getTime(),
  };
};

/** Creates multiple rate limiter instances connected to the same distributed backend */
export const createConnectedLimiters = async (
  count: number,
  distributedBackend: DistributedBackendInstance,
  createLimiter: (backend: BackendConfig, instanceId: number) => LLMRateLimiterInstance
): Promise<Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }>> => {
  const instances: Array<{ limiter: LLMRateLimiterInstance; unsubscribe: () => void }> = [];
  for (let i = ZERO; i < count; i += ONE) {
    const limiter = createLimiter(distributedBackend.backend, i);
    await limiter.start();
    const unsubscribe = distributedBackend.subscribe((avail) => {
      limiter.setDistributedAvailability(avail);
    });
    instances.push({ limiter, unsubscribe });
  }
  return instances;
};

export { type JobTracker, createJobTracker } from './jobTracker.helpers.js';
