import type { Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';

import { type ConfigPresetName, isValidPresetName } from '../rateLimiterConfigs.js';
import type { ResetOptions, ResetResult, ServerState } from '../serverState.js';
import type { DebugEventEmitter } from './eventEmitter.js';
import type { JobHistoryTracker } from './jobHistoryTracker.js';

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_INTERNAL_ERROR = 500;

/** Dependencies for debug routes */
export interface DebugRouteDeps {
  state: ServerState;
  resetServer: (options?: ResetOptions) => Promise<ResetResult>;
}

/** Get current state components (for convenience) */
const getStateComponents = (
  state: ServerState
): {
  rateLimiter: ServerState['rateLimiter'];
  eventEmitter: DebugEventEmitter;
  jobHistoryTracker: JobHistoryTracker;
} => ({
  rateLimiter: state.rateLimiter,
  eventEmitter: state.eventEmitter,
  jobHistoryTracker: state.jobHistoryTracker,
});

/**
 * Create debug routes for observability and testing.
 */
export const createDebugRoutes = (deps: DebugRouteDeps): Router => {
  const { state, resetServer } = deps;
  const router = createRouter();

  /**
   * GET /debug/stats
   * Returns full rate limiter stats including models, job types, and memory.
   */
  router.get('/stats', (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const stats = rateLimiter.getStats();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      stats,
    });
  });

  /**
   * GET /debug/active-jobs
   * Returns all active jobs (waiting or processing) from the rate limiter.
   */
  router.get('/active-jobs', (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const activeJobs = rateLimiter.getActiveJobs();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      activeJobs,
      count: activeJobs.length,
    });
  });

  /**
   * GET /debug/job-history
   * Returns historical completed and failed jobs.
   */
  router.get('/job-history', (_req: Request, res: Response): void => {
    const { rateLimiter, jobHistoryTracker } = getStateComponents(state);
    const history = jobHistoryTracker.getHistory();
    const summary = jobHistoryTracker.getSummary();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      history,
      summary,
    });
  });

  /**
   * POST /debug/reset
   * Reset the server: optionally clean Redis, create new rate limiter instance.
   * Body: { cleanRedis?: boolean, configPreset?: ConfigPresetName } - defaults to true, keep current
   */
  router.post('/reset', (req: Request, res: Response): void => {
    const body = req.body as { cleanRedis?: boolean; configPreset?: string } | undefined;
    const options: ResetOptions = { cleanRedis: body?.cleanRedis ?? true };

    // Validate and set configPreset if provided
    if (body?.configPreset !== undefined) {
      if (isValidPresetName(body.configPreset)) {
        options.configPreset = body.configPreset as ConfigPresetName;
      } else {
        res.status(HTTP_STATUS_BAD_REQUEST).json({
          success: false,
          error: `Invalid configPreset: ${body.configPreset}`,
          timestamp: Date.now(),
        });
        return;
      }
    }

    resetServer(options)
      .then((result) => {
        res.status(HTTP_STATUS_OK).json({
          ...result,
          timestamp: Date.now(),
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        res.status(HTTP_STATUS_INTERNAL_ERROR).json({
          success: false,
          error: message,
          timestamp: Date.now(),
        });
      });
  });

  /**
   * GET /debug/allocation
   * Returns the current allocation info including slotsByJobTypeAndModel.
   */
  router.get('/allocation', (_req: Request, res: Response): void => {
    const { rateLimiter } = getStateComponents(state);
    const allocation = rateLimiter.getAllocation();
    const instanceId = rateLimiter.getInstanceId();

    res.status(HTTP_STATUS_OK).json({
      instanceId,
      timestamp: Date.now(),
      allocation,
    });
  });

  /**
   * GET /debug/events
   * SSE endpoint for real-time event streaming.
   */
  router.get('/events', (req: Request, res: Response): void => {
    const { rateLimiter, eventEmitter } = getStateComponents(state);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Flush headers immediately
    res.flushHeaders();

    // Add client to event emitter
    const clientId = eventEmitter.addClient(res);

    // Send initial connection event
    const initialEvent = {
      type: 'connected',
      instanceId: rateLimiter.getInstanceId(),
      timestamp: Date.now(),
      clientId,
    };
    res.write(`data: ${JSON.stringify(initialEvent)}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
      eventEmitter.removeClient(clientId);
    });
  });

  return router;
};
