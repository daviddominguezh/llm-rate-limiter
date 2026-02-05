/**
 * Instance lifecycle management for E2E tests.
 * Provides functions to boot, kill, and query server instances programmatically.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

import { cleanRedis } from './redisCleanup.js';
import type { ConfigPresetName } from './resetInstance.js';

const HTTP_OK = 200;
const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const INSTANCE_READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 200;
const FORCE_KILL_TIMEOUT_MS = 5000;
const DEFAULT_ALLOCATION_TIMEOUT_MS = 10000;

interface ManagedInstance {
  process: ChildProcess;
  port: number;
  configPreset: ConfigPresetName;
}

/** Active instances managed by this module */
const instances = new Map<number, ManagedInstance>();

/** Allocation response from the debug endpoint */
export interface AllocationResponse {
  instanceId: string;
  timestamp: number;
  allocation: AllocationInfo | null;
}

/**
 * Sleep helper using native timers/promises
 */
const sleep = async (ms: number): Promise<void> => {
  await setTimeoutPromise(ms);
};

/**
 * Type guard for AllocationResponse
 */
const isAllocationResponse = (value: unknown): value is AllocationResponse =>
  typeof value === 'object' &&
  value !== null &&
  'instanceId' in value &&
  'timestamp' in value &&
  'allocation' in value;

/**
 * Fetch allocation info from a running instance using native fetch.
 */
export async function fetchAllocation(port: number): Promise<AllocationResponse> {
  const response = await fetch(`http://localhost:${port}/api/debug/allocation`);

  if (response.status !== HTTP_OK) {
    const body = await response.text();
    throw new Error(`HTTP ${String(response.status)}: ${body}`);
  }

  const data: unknown = await response.json();
  if (!isAllocationResponse(data)) {
    throw new Error('Failed to parse allocation response');
  }

  return data;
}

/**
 * Schedule force kill after timeout
 */
const scheduleForceKill = (instance: ManagedInstance, port: number): void => {
  setTimeout(() => {
    if (instances.has(port)) {
      instance.process.kill('SIGKILL');
    }
  }, FORCE_KILL_TIMEOUT_MS);
};

/**
 * Kill a running server instance.
 */
export async function killInstance(port: number): Promise<void> {
  const instance = instances.get(port);
  if (instance === undefined) {
    throw new Error(`No instance running on port ${port}`);
  }

  // Setup exit listener before killing
  const exitPromise = once(instance.process, 'exit');

  // Kill the process
  instance.process.kill('SIGTERM');
  scheduleForceKill(instance, port);

  // Wait for exit
  await exitPromise;
  instances.delete(port);
}

/**
 * Kill a single instance
 */
const killSingleInstance = async (port: number): Promise<void> => {
  await killInstance(port);
};

/**
 * Kill all running instances.
 */
export async function killAllInstances(): Promise<void> {
  const ports = Array.from(instances.keys());
  const killPromises = ports.map(killSingleInstance);
  await Promise.all(killPromises);
}

/**
 * Try to fetch allocation and check predicate
 */
const tryFetchAllocation = async (
  port: number,
  predicate: (allocation: AllocationInfo) => boolean
): Promise<AllocationInfo | null> => {
  try {
    const response = await fetchAllocation(port);
    const { allocation } = response;
    if (allocation !== null && predicate(allocation)) {
      return allocation;
    }
  } catch {
    // Ignore errors and keep polling
  }
  return null;
};

/**
 * Poll for allocation recursively
 */
const pollAllocationRecursive = async (
  port: number,
  predicate: (allocation: AllocationInfo) => boolean,
  startTime: number,
  timeoutMs: number
): Promise<AllocationInfo | null> => {
  if (Date.now() - startTime >= timeoutMs) {
    return null;
  }

  const result = await tryFetchAllocation(port, predicate);
  if (result !== null) {
    return result;
  }

  await sleep(POLL_INTERVAL_MS);
  return await pollAllocationRecursive(port, predicate, startTime, timeoutMs);
};

/**
 * Wait for an allocation update that matches the predicate.
 */
export async function waitForAllocationUpdate(
  port: number,
  predicate: (allocation: AllocationInfo) => boolean,
  timeoutMs = DEFAULT_ALLOCATION_TIMEOUT_MS
): Promise<AllocationInfo> {
  const result = await pollAllocationRecursive(port, predicate, Date.now(), timeoutMs);

  if (result === null) {
    throw new Error(`Allocation update timeout after ${timeoutMs}ms`);
  }

  return result;
}

/**
 * Try to check if instance is ready
 */
const tryCheckInstance = async (port: number): Promise<boolean> => {
  try {
    await fetchAllocation(port);
    return true;
  } catch {
    return false;
  }
};

/**
 * Poll for instance ready recursively
 */
const pollReadyRecursive = async (port: number, startTime: number): Promise<boolean> => {
  if (Date.now() - startTime >= INSTANCE_READY_TIMEOUT_MS) {
    return false;
  }

  const isReady = await tryCheckInstance(port);
  if (isReady) {
    return true;
  }

  await sleep(POLL_INTERVAL_MS);
  return await pollReadyRecursive(port, startTime);
};

/**
 * Clean up failed instance
 */
const cleanupFailedInstance = (port: number): void => {
  const instance = instances.get(port);
  if (instance !== undefined) {
    instance.process.kill('SIGKILL');
    instances.delete(port);
  }
};

/**
 * Wait for an instance to be ready (responding to requests).
 */
async function waitForInstanceReady(port: number): Promise<void> {
  const isReady = await pollReadyRecursive(port, Date.now());

  if (!isReady) {
    cleanupFailedInstance(port);
    throw new Error(`Instance on port ${port} failed to start within ${INSTANCE_READY_TIMEOUT_MS}ms`);
  }
}

/** Options for booting an instance */
export interface BootInstanceOptions {
  redisUrl?: string;
  maxMemoryMB?: number;
}

/**
 * Build NODE_OPTIONS string for memory constraint
 */
const buildNodeOptions = (maxMemoryMB: number | undefined): string | undefined => {
  if (maxMemoryMB === undefined) {
    return undefined;
  }
  return `--max-old-space-size=${maxMemoryMB}`;
};

/**
 * Boot a new server instance on the specified port.
 */
export async function bootInstance(
  port: number,
  configPreset: ConfigPresetName,
  options: BootInstanceOptions = {}
): Promise<void> {
  const { redisUrl = DEFAULT_REDIS_URL, maxMemoryMB } = options;

  if (instances.has(port)) {
    throw new Error(`Instance already running on port ${port}`);
  }

  const serverPath = resolve(import.meta.dirname, '../../serverInstance/src/main.ts');
  const nodeOptions = buildNodeOptions(maxMemoryMB);

  const proc = spawn('npx', ['tsx', serverPath], {
    env: {
      ...process.env,
      PORT: port.toString(),
      REDIS_URL: redisUrl,
      CONFIG_PRESET: configPreset,
      ...(nodeOptions === undefined ? {} : { NODE_OPTIONS: nodeOptions }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Log stdout/stderr for debugging
  proc.stdout.on('data', (data: Buffer) => {
    process.stdout.write(`[Instance:${port}] ${data.toString()}`);
  });
  proc.stderr.on('data', (data: Buffer) => {
    process.stderr.write(`[Instance:${port}:ERR] ${data.toString()}`);
  });

  instances.set(port, { process: proc, port, configPreset });

  await waitForInstanceReady(port);
}

// Re-export cleanRedis for backward compatibility
export { cleanRedis };
