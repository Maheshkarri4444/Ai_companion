import { Router } from 'express';
import { projectAnalyticsRouter } from '../analytics/analytics.routes';
import { growthRouter } from '../growth/growth.routes';
import { recommendationsRouter } from '../recommendations/recommendations.routes';
import { handler } from '../../lib/handler';
import { authenticate } from '../../middleware/authenticate';
import { knowledgeRouter } from '../knowledge/knowledge.routes';
import { masteryRouter } from '../mastery/mastery.routes';
import { materialsRouter } from '../materials/materials.routes';
import { quizRouter } from '../quiz/quiz.routes';
import { tutorRouter } from '../tutor/tutor.routes';
import { projectParams, recentProjectsQuery, updateProjectBody } from './projects.schemas';
import { deleteProject, getProjectDashboard, listRecentProjects, updateProject } from './projects.service';

export const projectsRouter = Router();
projectsRouter.use(authenticate);

// Declared before '/:projectId' so "recent" is never parsed as an id.
projectsRouter.get(
  '/recent',
  handler({ query: recentProjectsQuery }, async ({ auth, query }) => ({
    items: await listRecentProjects(auth.userId, query.limit),
  })),
);

projectsRouter.get(
  '/:projectId',
  handler({ params: projectParams }, ({ auth, params }) => getProjectDashboard(auth.userId, params.projectId)),
);

projectsRouter.patch(
  '/:projectId',
  handler({ params: projectParams, body: updateProjectBody }, async ({ auth, params, body }) => ({
    project: await updateProject(auth.userId, params.projectId, body),
  })),
);

projectsRouter.delete(
  '/:projectId',
  handler({ params: projectParams }, async ({ auth, params }) => {
    await deleteProject(auth.userId, params.projectId);
  }),
);

projectsRouter.use('/:projectId/materials', materialsRouter);
projectsRouter.use('/:projectId/tutor', tutorRouter);
projectsRouter.use('/:projectId/quizzes', quizRouter);
projectsRouter.use('/:projectId/mastery', masteryRouter);
projectsRouter.use('/:projectId/growth', growthRouter);
projectsRouter.use('/:projectId/recommendations', recommendationsRouter);
projectsRouter.use('/:projectId/analytics', projectAnalyticsRouter);
// Knowledge routes (concepts, page text, processing retry) live beside materials under the Project.
projectsRouter.use('/:projectId', knowledgeRouter);
