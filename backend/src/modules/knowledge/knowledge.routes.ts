import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { getMaterialPage, listProjectConcepts, retryMaterialProcessing } from './knowledge.service';

// Mounted under /api/projects/:projectId (authentication applied by the parent router).
export const knowledgeRouter = Router({ mergeParams: true });

const projectParams = z.object({ projectId: objectIdSchema });
const materialParams = z.object({ projectId: objectIdSchema, materialId: objectIdSchema });
const pageParams = materialParams.extend({ page: z.coerce.number().int().min(1).max(10_000) });

knowledgeRouter.get(
  '/concepts',
  handler({ params: projectParams }, async ({ auth, params }) => ({ items: await listProjectConcepts(auth.userId, params.projectId) })),
);

knowledgeRouter.post(
  '/materials/:materialId/retry',
  handler({ params: materialParams }, async ({ auth, params, res }) => {
    res.status(202);
    return { material: await retryMaterialProcessing(auth.userId, params.projectId, params.materialId) };
  }),
);

knowledgeRouter.get(
  '/materials/:materialId/pages/:page',
  handler({ params: pageParams }, async ({ auth, params }) => ({
    page: await getMaterialPage(auth.userId, params.projectId, params.materialId, params.page),
  })),
);
