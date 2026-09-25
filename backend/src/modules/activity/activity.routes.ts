import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { authenticate } from '../../middleware/authenticate';
import { ACTIVITY_TYPES } from '../../models/activityEvent.model';
import { listUserActivity } from './activity.service';
import { getHomeDashboard } from './dashboard.service';

const activityQuery = z.object({
  spaceId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const activityRouter = Router();
activityRouter.use(authenticate);

activityRouter.get(
  '/',
  handler({ query: activityQuery }, async ({ auth, query }) => ({ items: await listUserActivity(auth.userId, query) })),
);

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get(
  '/',
  handler({}, ({ auth }) => getHomeDashboard(auth.userId)),
);
