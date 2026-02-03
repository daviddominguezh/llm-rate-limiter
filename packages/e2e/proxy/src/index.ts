import 'dotenv/config';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PROXY_PORT = 3000;
const TARGET_HOST = 'localhost';
const FIRST_INDEX = 0;
const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;

/**
 * Parse target ports from environment variable or use defaults.
 * Set TARGET_PORTS env var to customize, e.g., "3001" for single instance
 * or "3001,3002" for two instances.
 */
const parseTargetPorts = (): number[] => {
  const envPorts = process.env.TARGET_PORTS;
  if (envPorts !== undefined && envPorts.length > 0) {
    return envPorts.split(',').map((p) => parseInt(p.trim(), 10));
  }
  // Default: both instances
  return [3001, 3002];
};

const TARGET_PORTS: readonly number[] = parseTargetPorts();

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const DEFAULT_PORT = 3001;

const getRandomTargetPort = (): number => {
  if (TARGET_PORTS.length === 0) {
    return DEFAULT_PORT;
  }
  const randomIndex = Math.floor(Math.random() * TARGET_PORTS.length);
  return TARGET_PORTS[randomIndex] ?? DEFAULT_PORT;
};

const proxyRequest = (req: IncomingMessage, res: ServerResponse): void => {
  const targetPort = getRandomTargetPort();

  log(`Proxying ${req.method} ${req.url} -> port ${targetPort}`);

  const proxyReq = httpRequest(
    {
      hostname: TARGET_HOST,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? HTTP_INTERNAL_ERROR, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    logError(`Proxy error to port ${targetPort}: ${error.message}`);
    res.writeHead(HTTP_BAD_GATEWAY);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
};

const server = createServer(proxyRequest);

server.listen(PROXY_PORT, () => {
  log(`Proxy server listening on port ${PROXY_PORT}`);
  log(`Load balancing between ports: ${TARGET_PORTS.join(', ')}`);
});
