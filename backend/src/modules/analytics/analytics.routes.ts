import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { authenticate } from '../../middleware/authenticate';
import { ANALYTICS_RANGES, getGlobalAnalytics, getProjectAnalytics, type AnalyticsRange } from './analytics.service';

const rangeQuery = z.object({ range: z.enum(Object.keys(ANALYTICS_RANGES) as [AnalyticsRange, ...AnalyticsRange[]]).default('30d') });

// Mounted under /api/projects/:projectId/analytics (authentication applied by the parent router).
export const projectAnalyticsRouter = Router({ mergeParams: true });
projectAnalyticsRouter.get(
  '/',
  handler({ params: z.object({ projectId: objectIdSchema }), query: rangeQuery }, ({ auth, params, query }) =>
    getProjectAnalytics(auth.userId, params.projectId, query.range),
  ),
);

// Mounted under /api/analytics — the learner's global analytics across Spaces and Projects.
export const globalAnalyticsRouter = Router();
globalAnalyticsRouter.use(authenticate);
globalAnalyticsRouter.get('/', handler({ query: rangeQuery }, ({ auth, query }) => getGlobalAnalytics(auth.userId, query.range)));
