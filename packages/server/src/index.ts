import 'dotenv/config';

import { EXIT_FAILURE, EXIT_SUCCESS } from './constants.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

export { createServer } from './server.js';
export { logger } from './logger.js';
export type { ServerConfig, QueueJobRequestBody, QueueJobResponse, QueuedJob } from './types.js';

const runServer = async (): Promise<void> => {
  const server = await createServer();

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await server.close();
    process.exit(EXIT_SUCCESS);
  };

  process.on('SIGINT', () => {
    shutdown().catch((error: unknown) => {
      logger.error('Shutdown error', { error });
    });
  });
  process.on('SIGTERM', () => {
    shutdown().catch((error: unknown) => {
      logger.error('Shutdown error', { error });
    });
  });
};

runServer().catch((error: unknown) => {
  logger.error('Failed to start server', { error });
  process.exit(EXIT_FAILURE);
});
