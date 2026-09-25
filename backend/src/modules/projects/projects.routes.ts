import { Router } from 'express';
import { handler } from '../../lib/handler';
import { authenticate } from '../../middleware/authenticate';
import { materialsRouter } from '../materials/materials.routes';
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
