/**
 * Proxy lifecycle management for E2E tests.
 * Provides functions to boot and kill the proxy server programmatically.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as setTimeoutPromise } from 'node:timers/promises';

const HTTP_OK = 200;
const PROXY_READY_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 200;
const FORCE_KILL_TIMEOUT_MS = 5000;
const DEFAULT_PROXY_PORT = 3000;

interface ManagedProxy {
  process: ChildProcess;
  port: number;
  targetPorts: number[];
}

/** Active proxy (only one at a time) */
let proxy: ManagedProxy | null = null;

/**
 * Sleep helper using native timers/promises
 */
const sleep = async (ms: number): Promise<void> => {
  await setTimeoutPromise(ms);
};

/**
 * Try to check if proxy is ready
 */
const tryCheckProxy = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://localhost:${port}/proxy/stats`);
    return response.status === HTTP_OK;
  } catch {
    return false;
  }
};

/**
 * Poll for proxy ready recursively
 */
const pollProxyReadyRecursive = async (port: number, startTime: number): Promise<boolean> => {
  if (Date.now() - startTime >= PROXY_READY_TIMEOUT_MS) {
    return false;
  }

  const isReady = await tryCheckProxy(port);
  if (isReady) {
    return true;
  }

  await sleep(POLL_INTERVAL_MS);
  return await pollProxyReadyRecursive(port, startTime);
};

/**
 * Clean up failed proxy
 */
const cleanupFailedProxy = (): void => {
  if (proxy !== null) {
    proxy.process.kill('SIGKILL');
    proxy = null;
  }
};

/**
 * Wait for proxy to be ready (responding to requests).
 */
async function waitForProxyReady(port: number): Promise<void> {
  const isReady = await pollProxyReadyRecursive(port, Date.now());

  if (!isReady) {
    cleanupFailedProxy();
    throw new Error(`Proxy on port ${port} failed to start within ${PROXY_READY_TIMEOUT_MS}ms`);
  }
}

/**
 * Boot the proxy server.
 */
export async function bootProxy(targetPorts: number[], port = DEFAULT_PROXY_PORT): Promise<void> {
  if (proxy !== null) {
    throw new Error(`Proxy already running on port ${proxy.port}`);
  }

  const proxyPath = resolve(import.meta.dirname, '../../proxy/src/index.ts');

  const proc = spawn('npx', ['tsx', proxyPath], {
    env: {
      ...process.env,
      TARGET_PORTS: targetPorts.join(','),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proxy = { process: proc, port, targetPorts };

  await waitForProxyReady(port);
}

/**
 * Kill the proxy server.
 */
export async function killProxy(): Promise<void> {
  const proxyRef = proxy;
  if (proxyRef === null) {
    throw new Error('No proxy running');
  }

  // Clear global reference immediately to prevent race conditions
  proxy = null;

  const exitPromise = once(proxyRef.process, 'exit');

  proxyRef.process.kill('SIGTERM');

  setTimeout(() => {
    proxyRef.process.kill('SIGKILL');
  }, FORCE_KILL_TIMEOUT_MS);

  await exitPromise;
}

/**
 * Check if proxy is currently running.
 */
export function isProxyRunning(): boolean {
  return proxy !== null;
}
