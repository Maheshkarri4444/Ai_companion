import { Router } from 'express';
import { pingDatabase } from '../../lib/db';

export const healthRouter = Router();

/** Liveness: the process is up and serving. */
healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

/** Readiness: dependencies are reachable (used by the host's health check). */
healthRouter.get('/ready', async (_req, res) => {
  const latencyMs = await pingDatabase();
  if (latencyMs === null) {
    res.status(503).json({ status: 'unavailable', database: { status: 'down' } });
    return;
  }
  res.json({ status: 'ready', database: { status: 'up', latencyMs } });
});
