import 'dotenv/config';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PROXY_PORT = 3000;
const TARGET_HOST = 'localhost';
const HTTP_BAD_GATEWAY = 502;
const HTTP_INTERNAL_ERROR = 500;
const FIRST_INDEX = 0;

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

/**
 * Parse target ratio from environment variable.
 * Set TARGET_RATIO env var to customize distribution, e.g., "26:25" for 26 jobs to first instance, 25 to second.
 * If not set, uses equal distribution (1:1:1:... for N instances).
 */
const parseTargetRatio = (portCount: number): number[] => {
  const envRatio = process.env.TARGET_RATIO;
  if (envRatio !== undefined && envRatio.length > 0) {
    const ratios = envRatio.split(':').map((r) => parseInt(r.trim(), 10));
    if (ratios.length === portCount && ratios.every((r) => !isNaN(r) && r > 0)) {
      return ratios;
    }
    // Invalid ratio, fall back to equal distribution
  }
  // Default: equal distribution
  return Array.from({ length: portCount }, () => 1);
};

const TARGET_PORTS: readonly number[] = parseTargetPorts();
let currentRatio: number[] = parseTargetRatio(TARGET_PORTS.length);

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

const DEFAULT_PORT = 3001;

/** Track job counts per instance for ratio-based distribution */
const jobCounts: number[] = Array.from({ length: TARGET_PORTS.length }, () => 0);

/** Calculate total ratio sum */
const getRatioSum = (): number => currentRatio.reduce((sum, r) => sum + r, 0);

/**
 * Get the next target port based on ratio distribution.
 * Uses deficit-based selection: sends to the instance that is furthest below its target ratio.
 */
const getNextTargetPort = (): number => {
  if (TARGET_PORTS.length === 0) {
    return DEFAULT_PORT;
  }
  if (TARGET_PORTS.length === 1) {
    return TARGET_PORTS[FIRST_INDEX] ?? DEFAULT_PORT;
  }

  const totalJobs = jobCounts.reduce((sum, c) => sum + c, 0);
  const ratioSum = getRatioSum();

  // Find the instance with the largest deficit (furthest below its target ratio)
  let bestIndex = FIRST_INDEX;
  let bestDeficit = -Infinity;

  for (let i = 0; i < TARGET_PORTS.length; i++) {
    const targetShare = (currentRatio[i] ?? 1) / ratioSum;
    const expectedJobs = totalJobs * targetShare;
    const actualJobs = jobCounts[i] ?? 0;
    const deficit = expectedJobs - actualJobs;

    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestIndex = i;
    }
  }

  // Increment the count for the selected instance
  jobCounts[bestIndex] = (jobCounts[bestIndex] ?? 0) + 1;

  return TARGET_PORTS[bestIndex] ?? DEFAULT_PORT;
};

/** Reset job counts (can be called via API endpoint) */
const resetJobCounts = (): void => {
  for (let i = 0; i < jobCounts.length; i++) {
    jobCounts[i] = 0;
  }
};

/** Set the distribution ratio */
const setRatio = (ratioStr: string): boolean => {
  const ratios = ratioStr.split(':').map((r) => parseInt(r.trim(), 10));
  if (ratios.length === TARGET_PORTS.length && ratios.every((r) => !isNaN(r) && r > 0)) {
    currentRatio = ratios;
    return true;
  }
  return false;
};

/** Collect request body */
const collectBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** Handle proxy config API endpoints */
const handleConfigApi = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (req.url === '/proxy/reset' && req.method === 'POST') {
    resetJobCounts();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Job counts reset' }));
    return true;
  }
  if (req.url === '/proxy/stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ports: TARGET_PORTS,
        ratio: currentRatio,
        jobCounts,
        totalJobs: jobCounts.reduce((sum, c) => sum + c, 0),
      })
    );
    return true;
  }
  if (req.url === '/proxy/ratio' && req.method === 'POST') {
    collectBody(req)
      .then((body) => {
        const { ratio } = JSON.parse(body) as { ratio: string };
        if (setRatio(ratio)) {
          resetJobCounts(); // Reset counts when ratio changes
          log(`Ratio updated to: ${currentRatio.join(':')}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ratio: currentRatio }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid ratio format' }));
        }
      })
      .catch((err: unknown) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      });
    return true;
  }
  return false;
};

const proxyRequest = (req: IncomingMessage, res: ServerResponse): void => {
  // Handle proxy config API endpoints
  if (handleConfigApi(req, res)) {
    return;
  }

  const targetPort = getNextTargetPort();

  log(`Proxying ${req.method} ${req.url} -> port ${targetPort} (counts: ${jobCounts.join(', ')})`);

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
  log(`Distribution ratio: ${currentRatio.join(':')}`);
  log(`API endpoints: POST /proxy/reset, POST /proxy/ratio, GET /proxy/stats`);
});
