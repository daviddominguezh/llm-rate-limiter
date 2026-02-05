/**
 * Instance lifecycle management for E2E tests.
 * Provides functions to boot, kill, and query server instances programmatically.
 */
import type { AllocationInfo } from '@llm-rate-limiter/core';
import { Redis } from 'ioredis';
import { type ChildProcess, spawn } from 'node:child_process';
import { request } from 'node:http';
import { resolve } from 'node:path';

import type { ConfigPresetName } from './resetInstance.js';

const HTTP_OK = 200;
const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const INSTANCE_READY_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 200;

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
 * Boot a new server instance on the specified port.
 * @param port - The port to run the instance on
 * @param configPreset - Configuration preset name
 * @param redisUrl - Redis URL (defaults to localhost:6379)
 * @returns Promise that resolves when the instance is ready
 */
export async function bootInstance(
  port: number,
  configPreset: ConfigPresetName,
  redisUrl = DEFAULT_REDIS_URL
): Promise<void> {
  if (instances.has(port)) {
    throw new Error(`Instance already running on port ${port}`);
  }

  // Path to the server main file
  const serverPath = resolve(import.meta.dirname, '../../serverInstance/dist/main.js');

  const proc = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: port.toString(),
      REDIS_URL: redisUrl,
      CONFIG_PRESET: configPreset,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  instances.set(port, { process: proc, port, configPreset });

  // Wait for the instance to be ready
  await waitForInstanceReady(port);
}

/**
 * Kill a running server instance.
 * @param port - The port of the instance to kill
 */
export async function killInstance(port: number): Promise<void> {
  const instance = instances.get(port);
  if (instance === undefined) {
    throw new Error(`No instance running on port ${port}`);
  }

  return new Promise((resolve) => {
    instance.process.on('exit', () => {
      instances.delete(port);
      resolve();
    });

    // Send SIGTERM for graceful shutdown
    instance.process.kill('SIGTERM');

    // Force kill after timeout
    setTimeout(() => {
      if (instances.has(port)) {
        instance.process.kill('SIGKILL');
      }
    }, 5000);
  });
}

/**
 * Kill all running instances.
 */
export async function killAllInstances(): Promise<void> {
  const ports = Array.from(instances.keys());
  await Promise.all(ports.map((port) => killInstance(port)));
}

/**
 * Fetch allocation info from a running instance.
 * @param port - The port of the instance to query
 * @returns Promise resolving to the allocation response
 */
export async function fetchAllocation(port: number): Promise<AllocationResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: 'localhost',
        port,
        path: '/api/debug/allocation',
        method: 'GET',
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === HTTP_OK) {
            try {
              const data = JSON.parse(body) as AllocationResponse;
              resolve(data);
            } catch (error) {
              reject(new Error(`Failed to parse allocation response: ${String(error)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(new Error(`Failed to fetch allocation: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Wait for an allocation update that matches the predicate.
 * @param port - The port of the instance to poll
 * @param predicate - Function that returns true when the desired allocation state is reached
 * @param timeoutMs - Maximum time to wait (default: 10 seconds)
 * @returns Promise resolving to the matching allocation
 */
export async function waitForAllocationUpdate(
  port: number,
  predicate: (allocation: AllocationInfo) => boolean,
  timeoutMs = 10000
): Promise<AllocationInfo> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetchAllocation(port);
      if (response.allocation !== null && predicate(response.allocation)) {
        return response.allocation;
      }
    } catch {
      // Ignore errors and keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Allocation update timeout after ${timeoutMs}ms`);
}

/**
 * Wait for an instance to be ready (responding to requests).
 */
async function waitForInstanceReady(port: number): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < INSTANCE_READY_TIMEOUT_MS) {
    try {
      await fetchAllocation(port);
      return; // Instance is ready
    } catch {
      // Not ready yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // Instance failed to start, clean up
  const instance = instances.get(port);
  if (instance !== undefined) {
    instance.process.kill('SIGKILL');
    instances.delete(port);
  }

  throw new Error(`Instance on port ${port} failed to start within ${INSTANCE_READY_TIMEOUT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default key prefixes used by the rate limiter */
const KEY_PREFIXES = ['llm-rl:', 'llm-rate-limiter:'];
const ZERO = 0;
const BATCH_SIZE = 100;

/**
 * Clean all rate limiter keys from Redis.
 * Should be called before starting fresh instances in tests.
 * @param redisUrl - Redis URL (defaults to localhost:6379)
 */
export async function cleanRedis(redisUrl = DEFAULT_REDIS_URL): Promise<number> {
  const redis = new Redis(redisUrl);
  let totalDeleted = ZERO;

  try {
    for (const prefix of KEY_PREFIXES) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', BATCH_SIZE);
        cursor = nextCursor;
        if (keys.length > ZERO) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');
    }
  } finally {
    await redis.quit();
  }

  return totalDeleted;
}
