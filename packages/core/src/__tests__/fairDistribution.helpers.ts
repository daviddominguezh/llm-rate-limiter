/**
 * Test backend implementing V2 protocol with fair distribution algorithm.
 * Used for testing distributed slot allocation across multiple instances.
 */
import type {
  AllocationCallback,
  AllocationInfo,
  BackendAcquireContext,
  BackendConfig,
  BackendReleaseContext,
  Unsubscribe,
} from '../multiModelTypes.js';

const ZERO = 0;
const ONE = 1;

/** Configuration for the fair distribution backend */
export interface FairDistributionBackendConfig {
  /** Total capacity to distribute across all instances */
  totalCapacity: number;
  /** Estimated tokens per request (for allocation calculation) */
  estimatedTokensPerRequest: number;
}

/** Tracked instance state */
interface TrackedInstance {
  id: string;
  inFlight: number;
  allocation: number;
  callback: AllocationCallback;
}

/** Statistics for test inspection */
export interface FairDistributionStats {
  totalInFlight: number;
  totalAllocated: number;
  instanceCount: number;
}

/** Instance stats for test inspection */
export interface InstanceStats {
  inFlight: number;
  allocation: number;
}

/**
 * Fair distribution backend for testing V2 distributed rate limiting.
 * Implements the fair share algorithm for slot distribution.
 */
export class FairDistributionBackend {
  private readonly instances = new Map<string, TrackedInstance>();
  private readonly totalCapacity: number;
  private readonly estimatedTokensPerRequest: number;

  constructor(config: FairDistributionBackendConfig) {
    const { totalCapacity, estimatedTokensPerRequest } = config;
    this.totalCapacity = totalCapacity;
    this.estimatedTokensPerRequest = estimatedTokensPerRequest;
  }

  /** Get the backend config to pass to rate limiter */
  getBackendConfig(): BackendConfig {
    return {
      register: async (id: string): Promise<AllocationInfo> => await this.register(id),
      unregister: async (id: string): Promise<void> => {
        await this.unregister(id);
      },
      acquire: async (ctx: BackendAcquireContext): Promise<boolean> => await this.acquire(ctx),
      release: async (ctx: BackendReleaseContext): Promise<void> => {
        await this.release(ctx);
      },
      subscribe: (id: string, cb: AllocationCallback): Unsubscribe => this.subscribe(id, cb),
    };
  }

  /** Register a new instance */
  private async register(instanceId: string): Promise<AllocationInfo> {
    this.instances.set(instanceId, {
      id: instanceId,
      inFlight: ZERO,
      allocation: ZERO,
      callback: (): void => {
        /* placeholder */
      },
    });
    this.recalculateAllocations();
    const inst = this.instances.get(instanceId);
    if (inst === undefined) {
      throw new Error(`Instance ${instanceId} not found after registration`);
    }
    return await Promise.resolve(this.buildAllocationInfo(inst.allocation));
  }

  /** Unregister an instance */
  private async unregister(instanceId: string): Promise<void> {
    this.instances.delete(instanceId);
    this.recalculateAllocations();
    await Promise.resolve();
  }

  /** Subscribe to allocation updates */
  private subscribe(instanceId: string, callback: AllocationCallback): Unsubscribe {
    const inst = this.instances.get(instanceId);
    if (inst !== undefined) {
      inst.callback = callback;
      callback(this.buildAllocationInfo(inst.allocation));
    }
    return (): void => {
      const i = this.instances.get(instanceId);
      if (i !== undefined) {
        i.callback = (): void => {
          /* unsubscribed */
        };
      }
    };
  }

  /** Acquire a slot from instance's allocation */
  private async acquire(ctx: BackendAcquireContext): Promise<boolean> {
    const inst = this.instances.get(ctx.instanceId);
    if (inst === undefined || inst.allocation <= ZERO) {
      return await Promise.resolve(false);
    }
    inst.allocation -= ONE;
    inst.inFlight += ONE;
    this.recalculateAllocations();
    return await Promise.resolve(true);
  }

  /** Release a slot (decrement in-flight, trigger reallocation) */
  private async release(ctx: BackendReleaseContext): Promise<void> {
    const inst = this.instances.get(ctx.instanceId);
    if (inst === undefined || inst.inFlight <= ZERO) {
      return;
    }
    inst.inFlight -= ONE;
    this.recalculateAllocations();
    await Promise.resolve();
  }

  /**
   * Recalculate allocations using the fair distribution algorithm.
   *
   * Algorithm:
   * 1. Calculate fair share = totalCapacity / numInstances
   * 2. For each instance: need = max(0, fairShare - inFlight)
   * 3. totalNeed = sum of all needs
   * 4. available = totalCapacity - totalInFlight
   * 5. Each instance allocation = floor((need / totalNeed) * available)
   */
  private recalculateAllocations(): void {
    const { instances, totalCapacity } = this;
    const { size: n } = instances;
    if (n === ZERO) {
      return;
    }

    const fairShare = Math.floor(totalCapacity / n);
    let totalInFlight = ZERO;
    let totalNeed = ZERO;
    const needs: Array<{ inst: TrackedInstance; need: number }> = [];

    for (const inst of instances.values()) {
      totalInFlight += inst.inFlight;
      const need = Math.max(ZERO, fairShare - inst.inFlight);
      needs.push({ inst, need });
      totalNeed += need;
    }

    const available = Math.max(ZERO, this.totalCapacity - totalInFlight);

    for (const { inst, need } of needs) {
      const newAllocation = totalNeed === ZERO ? ZERO : Math.floor((need / totalNeed) * available);
      inst.allocation = newAllocation;
      inst.callback(this.buildAllocationInfo(newAllocation));
    }
  }

  /** Build AllocationInfo from slots count */
  private buildAllocationInfo(slots: number): AllocationInfo {
    return {
      slots,
      tokensPerMinute: slots * this.estimatedTokensPerRequest,
      requestsPerMinute: slots,
    };
  }

  // ==========================================================================
  // Test Inspection Methods
  // ==========================================================================

  /** Get total in-flight jobs across all instances */
  getTotalInFlight(): number {
    let total = ZERO;
    for (const inst of this.instances.values()) {
      total += inst.inFlight;
    }
    return total;
  }

  /** Get total allocated slots across all instances */
  getTotalAllocated(): number {
    let total = ZERO;
    for (const inst of this.instances.values()) {
      total += inst.allocation;
    }
    return total;
  }

  /** Get number of registered instances */
  getInstanceCount(): number {
    return this.instances.size;
  }

  /** Get stats for a specific instance */
  getInstanceStats(instanceId: string): InstanceStats | undefined {
    const inst = this.instances.get(instanceId);
    if (inst === undefined) {
      return undefined;
    }
    return { inFlight: inst.inFlight, allocation: inst.allocation };
  }

  /** Get overall stats */
  getStats(): FairDistributionStats {
    return {
      totalInFlight: this.getTotalInFlight(),
      totalAllocated: this.getTotalAllocated(),
      instanceCount: this.getInstanceCount(),
    };
  }

  /** Get the total capacity configured */
  getTotalCapacity(): number {
    return this.totalCapacity;
  }
}

/** Assert that total in-flight + allocated never exceeds capacity */
export const assertCapacityInvariant = (backend: FairDistributionBackend): void => {
  const stats = backend.getStats();
  const total = stats.totalInFlight + stats.totalAllocated;
  const capacity = backend.getTotalCapacity();
  if (total > capacity) {
    throw new Error(
      `Capacity invariant violated: inFlight(${stats.totalInFlight}) + allocated(${stats.totalAllocated}) = ${total} > capacity(${capacity})`
    );
  }
};
