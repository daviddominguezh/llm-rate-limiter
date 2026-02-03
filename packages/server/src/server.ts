import type { Server } from 'node:http';
import { promisify } from 'node:util';

import express, { type Express } from 'express';

import { env } from './env.js';
import { logger } from './logger.js';
import { findAvailablePort } from './portUtils.js';
import { type ServerRateLimiter, createRateLimiterInstance } from './rateLimiterSetup.js';
import { createRoutes } from './routes.js';
import type { ServerConfig } from './types.js';

interface CloseServerParams {
  server: Server;
  rateLimiter: ServerRateLimiter;
}

type ServerCloseCallback = (err?: Error) => void;

interface ServerInstance {
  app: Express;
  rateLimiter: ServerRateLimiter;
  port: number;
  close: () => Promise<void>;
}

export const createServer = async (config: ServerConfig = {}): Promise<ServerInstance> => {
  const {
    primaryPort = env.port,
    fallbackPort = env.fallbackPort,
    redisUrl = env.redisUrl,
  } = config;

  const port = await findAvailablePort([primaryPort, fallbackPort]);

  const rateLimiter = createRateLimiterInstance(redisUrl);
  await rateLimiter.start();
  logger.info('Rate limiter started');

  const app = express();

  app.use(express.json());
  app.use('/api', createRoutes(rateLimiter));

  const server = app.listen(port, () => {
    logger.info(`Server running on http://localhost:${port}`);
    logger.info(`Queue endpoint: POST http://localhost:${port}/api/queue-job`);
  });

  const close = createCloseHandler({ server, rateLimiter });

  return { app, rateLimiter, port, close };
};

export const createCloseHandler = (params: CloseServerParams): (() => Promise<void>) => {
  const { server, rateLimiter } = params;

  return async (): Promise<void> => {
    rateLimiter.stop();
    logger.info('Rate limiter stopped');

    const closeAsync = promisify((callback: ServerCloseCallback) => {
      server.close(callback);
    });

    await closeAsync();
    logger.info('Server closed');
  };
};
