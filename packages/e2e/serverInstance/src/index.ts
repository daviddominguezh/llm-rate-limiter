import 'dotenv/config';

import { createServer, logger } from '@llm-rate-limiter/server';

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

const runServer = async (): Promise<void> => {
  const serverInstance = await createServer();

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down...');
    await serverInstance.close();
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
