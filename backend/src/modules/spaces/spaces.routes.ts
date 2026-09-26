import { Router } from 'express';
import { handler } from '../../lib/handler';
import { authenticate } from '../../middleware/authenticate';
import { getSpaceLearning } from '../activity/dashboard.service';
import { createProjectBody } from '../projects/projects.schemas';
import { createProject, listProjects } from '../projects/projects.service';
import { createSpaceBody, spaceParams, updateSpaceBody } from './spaces.schemas';
import { createSpace, deleteSpace, getSpaceDashboard, listSpaces, updateSpace } from './spaces.service';

export const spacesRouter = Router();
spacesRouter.use(authenticate);

spacesRouter.get(
  '/',
  handler({}, async ({ auth }) => ({ items: await listSpaces(auth.userId) })),
);

spacesRouter.post(
  '/',
  handler({ body: createSpaceBody }, async ({ auth, body, res }) => {
    res.status(201);
    return { space: await createSpace(auth.userId, body) };
  }),
);

spacesRouter.get(
  '/:spaceId',
  handler({ params: spaceParams }, async ({ auth, params }) => {
    // The learning view is owner-scoped on its own; the dashboard call performs the ownership check (404).
    const [dashboard, learning] = await Promise.all([getSpaceDashboard(auth.userId, params.spaceId), getSpaceLearning(auth.userId, params.spaceId)]);
    return { ...dashboard, ...learning };
  }),
);

spacesRouter.patch(
  '/:spaceId',
  handler({ params: spaceParams, body: updateSpaceBody }, async ({ auth, params, body }) => ({
    space: await updateSpace(auth.userId, params.spaceId, body),
  })),
);

spacesRouter.delete(
  '/:spaceId',
  handler({ params: spaceParams }, async ({ auth, params }) => {
    await deleteSpace(auth.userId, params.spaceId);
  }),
);

spacesRouter.get(
  '/:spaceId/projects',
  handler({ params: spaceParams }, async ({ auth, params }) => ({ items: await listProjects(auth.userId, params.spaceId) })),
);

spacesRouter.post(
  '/:spaceId/projects',
  handler({ params: spaceParams, body: createProjectBody }, async ({ auth, params, body, res }) => {
    res.status(201);
    return { project: await createProject(auth.userId, params.spaceId, body) };
  }),
);
