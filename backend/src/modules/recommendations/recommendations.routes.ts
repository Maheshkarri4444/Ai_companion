import { Router } from 'express';
import { z } from 'zod';
import { handler } from '../../lib/handler';
import { objectIdSchema } from '../../lib/validation';
import { actOnRecommendation, dismissRecommendation, getProjectRecommendations } from './recommendations.service';

// Mounted under /api/projects/:projectId/recommendations (authentication applied by the parent router).
export const recommendationsRouter = Router({ mergeParams: true });

const projectParams = z.object({ projectId: objectIdSchema });
const recParams = projectParams.extend({ recommendationId: objectIdSchema });

recommendationsRouter.get('/', handler({ params: projectParams }, ({ auth, params }) => getProjectRecommendations(auth.userId, params.projectId)));

/** The learner followed the recommendation (the UI calls this right before navigating to the action). */
recommendationsRouter.post(
  '/:recommendationId/act',
  handler({ params: recParams }, async ({ auth, params }) => {
    await actOnRecommendation(auth.userId, params.projectId, params.recommendationId);
  }),
);

recommendationsRouter.post(
  '/:recommendationId/dismiss',
  handler({ params: recParams }, ({ auth, params }) => dismissRecommendation(auth.userId, params.projectId, params.recommendationId)),
);
