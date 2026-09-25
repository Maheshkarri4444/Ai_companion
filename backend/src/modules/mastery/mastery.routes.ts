import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { listProjectMastery } from './mastery.service';

// Mounted under /api/projects/:projectId/mastery (authentication applied by the parent router).
export const masteryRouter = Router({ mergeParams: true });

masteryRouter.get(
  '/',
  handler({ params: z.object({ projectId: objectIdSchema }) }, ({ auth, params }) => listProjectMastery(auth.userId, params.projectId)),
);
