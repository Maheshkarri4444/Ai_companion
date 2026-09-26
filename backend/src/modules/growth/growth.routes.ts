import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { getProjectGrowth, GROWTH_WINDOWS, type GrowthWindow } from './growth.service';

// Mounted under /api/projects/:projectId/growth (authentication applied by the parent router).
export const growthRouter = Router({ mergeParams: true });

growthRouter.get(
  '/',
  handler(
    {
      params: z.object({ projectId: objectIdSchema }),
      query: z.object({ window: z.enum(Object.keys(GROWTH_WINDOWS) as [GrowthWindow, ...GrowthWindow[]]).default('30d') }),
    },
    ({ auth, params, query }) => getProjectGrowth(auth.userId, params.projectId, query.window),
  ),
);
