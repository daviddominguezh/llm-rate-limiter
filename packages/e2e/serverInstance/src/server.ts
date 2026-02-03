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

interface CloseServerParams {
  server: Server;
  state: ServerState;
}

type ServerCloseCallback = (err?: Error) => void;

interface ServerInstance {
  app: Express;
  state: ServerState;
  port: number;
  close: () => Promise<void>;
}

export const createServer = async (config: ServerConfig = {}): Promise<ServerInstance> => {
  const { primaryPort = env.port, fallbackPort = env.fallbackPort, redisUrl = env.redisUrl } = config;

  const port = await findAvailablePort([primaryPort, fallbackPort]);

  // Create mutable server state
  const state = createServerState(redisUrl);

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

  const close = createCloseHandler({ server, state });

  return { app, state, port, close };
};

export const createCloseHandler = (params: CloseServerParams): (() => Promise<void>) => {
  const { server, state } = params;

  return async (): Promise<void> => {
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
