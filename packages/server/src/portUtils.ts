import { once } from 'node:events';
import { type Server, createServer } from 'node:net';

const attemptListen = async (server: Server, port: number): Promise<boolean> => {
  try {
    server.listen(port);
    await once(server, 'listening');
    server.close();
    await once(server, 'close');
    return true;
  } catch {
    return false;
  }
};

export const isPortAvailable = async (port: number): Promise<boolean> => {
  const server = createServer();
  return await attemptListen(server, port);
};

export const findAvailablePort = async (ports: number[]): Promise<number> => {
  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      available: await isPortAvailable(port),
    }))
  );

  const available = results.find((r) => r.available);
  if (available !== undefined) {
    return available.port;
  }

  throw new Error(`No available ports found. Tried: ${ports.join(', ')}`);
};
