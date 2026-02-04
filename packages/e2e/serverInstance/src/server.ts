import express, { type Express } from 'express';
import type { Server } from 'node:http';
import { promisify } from 'node:util';

import { createDebugRoutes } from './debug/index.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { findAvailablePort } from './portUtils.js';
import { createRoutes } from './routes.js';
import { type ResetOptions, type ServerState, createServerState, resetServerState } from './serverState.js';
import type { ServerConfig } from './types.js';

const STATUS_LOG_INTERVAL_MS = 10000;

interface CloseServerParams {
  server: Server;
  state: ServerState;
  statusIntervalId: NodeJS.Timeout;
}

type ServerCloseCallback = (err?: Error) => void;

export interface ServerInstance {
  app: Express;
  state: ServerState;
  port: number;
  close: () => Promise<void>;
}

export const createServer = async (config: ServerConfig = {}): Promise<ServerInstance> => {
  const {
    primaryPort = env.port,
    fallbackPort = env.fallbackPort,
    redisUrl = env.redisUrl,
    configPreset = env.configPreset,
  } = config;

  const port = await findAvailablePort([primaryPort, fallbackPort]);

  // Create mutable server state
  const state = createServerState(redisUrl, configPreset);

  // Start the rate limiter
  await state.rateLimiter.start();
  logger.info('Rate limiter started');

  const app = express();

  app.use(express.json());

  // Create reset function that captures redisUrl
  const resetServer = async (options?: ResetOptions) => resetServerState(state, redisUrl, options);

  // Mount main routes with state
  app.use('/api', createRoutes({ state }));

  // Mount debug routes with state and reset function
  app.use('/api/debug', createDebugRoutes({ state, resetServer }));

  const server = app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info(`Queue endpoint: POST http://localhost:${port}/api/queue-job`);
    logger.info(`Debug SSE: GET http://localhost:${port}/api/debug/events`);
    logger.info(`Reset endpoint: POST http://localhost:${port}/api/debug/reset`);
  });

  // Log status every 10 seconds
  const statusIntervalId = setInterval(() => {
    logServerStatus(state, port);
  }, STATUS_LOG_INTERVAL_MS);

  const close = createCloseHandler({ server, state, statusIntervalId });

  return { app, state, port, close };
};

/** Log current server status: active jobs and model capacity */
const logServerStatus = (state: ServerState, port: number): void => {
  const activeJobs = state.rateLimiter.getActiveJobs();
  const stats = state.rateLimiter.getStats();

  const waitingJobs = activeJobs.filter((j) => j.status !== 'processing');
  const processingJobs = activeJobs.filter((j) => j.status === 'processing');

  logger.info(`[STATUS:${port}] Queue state`, {
    activeJobs: activeJobs.length,
    waiting: waitingJobs.length,
    processing: processingJobs.length,
  });

  for (const [modelId, modelStats] of Object.entries(stats.models)) {
    const tpm = modelStats.tokensPerMinute;
    const rpm = modelStats.requestsPerMinute;
    const conc = modelStats.concurrency;

    // Build status object with available limits
    const statusObj: Record<string, string> = {};

    if (tpm !== undefined) {
      statusObj.tpm = `${tpm.current}/${tpm.limit} (${tpm.remaining} remaining)`;
    }
    if (rpm !== undefined) {
      statusObj.rpm = `${rpm.current}/${rpm.limit}`;
    }
    if (conc !== undefined) {
      statusObj.concurrent = `${conc.active}/${conc.limit} (${conc.available} available)`;
    }
    if (Object.keys(statusObj).length === 0) {
      statusObj.limits = 'none';
    }

    logger.info(`[STATUS:${port}] ${modelId}`, statusObj);
  }
};

export const createCloseHandler = (params: CloseServerParams): (() => Promise<void>) => {
  const { server, state, statusIntervalId } = params;

  return async (): Promise<void> => {
    // Stop status logging interval
    clearInterval(statusIntervalId);

    // Close SSE connections first
    state.eventEmitter.closeAll();
    logger.info('SSE connections closed');

    // Stop job history tracker cleanup interval
    state.jobHistoryTracker.stop();

    state.rateLimiter.stop();
    logger.info('Rate limiter stopped');

    const closeAsync = promisify((callback: ServerCloseCallback) => {
      server.close(callback);
    });

    await closeAsync();
    logger.info('Server closed');
  };
};
