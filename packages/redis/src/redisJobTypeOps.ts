/**
 * Job type operations for Redis backend.
 */
import type { ResourcesPerJob } from '@llm-rate-limiter/core';
import type { Redis as RedisType } from 'ioredis';

import { SUCCESS_RESULT } from './constants.js';
import {
  ACQUIRE_JOB_TYPE_SCRIPT,
  GET_JOB_TYPES_STATS_SCRIPT,
  INIT_JOB_TYPES_SCRIPT,
  RELEASE_JOB_TYPE_SCRIPT,
  SET_JOB_TYPE_CAPACITY_SCRIPT,
} from './luaScripts.js';
import type { RedisKeys } from './redisHelpers.js';
import { buildJobTypesInitData, evalScript } from './redisHelpers.js';
import { ignoreError, parseJobTypeStats } from './redisTypeGuards.js';
import type { RedisJobTypeStats } from './types.js';

/** Handles job type operations for Redis backend */
export class RedisJobTypeOps {
  private initialized = false;
  readonly initPromise: Promise<void> | null;

  constructor(
    private readonly redis: RedisType,
    private readonly keys: RedisKeys,
    resourcesPerJob: ResourcesPerJob | undefined,
    totalCapacity: number
  ) {
    if (resourcesPerJob === undefined) {
      this.initPromise = null;
    } else {
      const promise = this.init(resourcesPerJob, totalCapacity);
      promise.catch(ignoreError);
      this.initPromise = promise;
    }
  }

  private async init(resourcesPerJob: ResourcesPerJob, totalCapacity: number): Promise<void> {
    const initData = buildJobTypesInitData(resourcesPerJob);
    await evalScript(this.redis, INIT_JOB_TYPES_SCRIPT, [this.keys.jobTypes], [JSON.stringify(initData)]);
    await evalScript(
      this.redis,
      SET_JOB_TYPE_CAPACITY_SCRIPT,
      [this.keys.jobTypes, this.keys.jobTypeChannel],
      [String(totalCapacity)]
    );
    this.initialized = true;
  }

  async acquire(instanceId: string, jobTypeId: string): Promise<boolean> {
    if (this.initPromise !== null) await this.initPromise;
    if (!this.initialized) return false;
    try {
      const result = await evalScript(
        this.redis,
        ACQUIRE_JOB_TYPE_SCRIPT,
        [this.keys.jobTypes, this.keys.jobTypeInstances],
        [instanceId, jobTypeId]
      );
      return result === SUCCESS_RESULT;
    } catch {
      return false;
    }
  }

  async release(instanceId: string, jobTypeId: string): Promise<void> {
    if (this.initPromise !== null) await this.initPromise;
    if (!this.initialized) return;
    await evalScript(
      this.redis,
      RELEASE_JOB_TYPE_SCRIPT,
      [this.keys.jobTypes, this.keys.jobTypeInstances],
      [instanceId, jobTypeId]
    );
  }

  async getStats(): Promise<RedisJobTypeStats | undefined> {
    if (this.initPromise !== null) await this.initPromise;
    if (!this.initialized) return undefined;
    const result = await evalScript(this.redis, GET_JOB_TYPES_STATS_SCRIPT, [this.keys.jobTypes], []);
    return parseJobTypeStats(result);
  }
}
