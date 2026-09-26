import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { registerModules } from './bootstrap';
import { config } from './config/env';
import { getContext } from './lib/context';
import { logger } from './lib/logger';
import { csrfGuard } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestContext } from './middleware/requestContext';
import { activityRouter, dashboardRouter } from './modules/activity/activity.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { globalAnalyticsRouter } from './modules/analytics/analytics.routes';
import { authRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { spacesRouter } from './modules/spaces/spaces.routes';

/** Builds the Express app without listening, so tests can drive it in-process. */
export function createApp() {
  registerModules();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => getContext()?.requestId ?? String(req.headers['x-request-id'] ?? ''),
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      // One compact line per request; headers (cookies included) are never logged.
      serializers: {
        req: (req: { method?: string; url?: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      // originalUrl: routers rewrite req.url to the mount-relative path.
      customSuccessMessage: (req, res, ms) =>
        `${req.method} ${(req as express.Request).originalUrl ?? req.url} → ${res.statusCode} (${Math.round(ms)}ms)`,
      customErrorMessage: (req, res, err) =>
        `${req.method} ${(req as express.Request).originalUrl ?? req.url} → ${res.statusCode}: ${err.message}`,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(helmet());
  // Browsers reach the API same-origin through the Next.js proxy; CORS only matters for direct access.
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', csrfGuard);

  app.get('/', (_req, res) => {
    res.json({ name: 'AI Study Companion API', version: config.APP_VERSION, health: '/api/health' });
  });
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/activity', activityRouter);
  app.use('/api/analytics', globalAnalyticsRouter);
  app.use('/api/spaces', spacesRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
