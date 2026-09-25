import { Router } from 'express';
import { handler } from '../../lib/handler';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { streamPdf } from '../materials/pdf';
import {
  activityQuery,
  adminMaterialParams,
  materialsQuery,
  projectsQuery,
  spacesQuery,
  userParams,
  usersQuery,
} from './admin.schemas';
import {
  getOverview,
  getSystemHealth,
  getUserDetail,
  listActivity,
  listActivityTypes,
  listMaterials,
  listProjects,
  listSpaces,
  listUsers,
  openMaterialFileAsAdmin,
} from './admin.service';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('admin'));

adminRouter.get('/overview', handler({}, () => getOverview()));

adminRouter.get('/users', handler({ query: usersQuery }, ({ query }) => listUsers(query)));
adminRouter.get('/users/:userId', handler({ params: userParams }, ({ params }) => getUserDetail(params.userId)));

adminRouter.get('/spaces', handler({ query: spacesQuery }, ({ query }) => listSpaces(query)));
adminRouter.get('/projects', handler({ query: projectsQuery }, ({ query }) => listProjects(query)));
adminRouter.get('/materials', handler({ query: materialsQuery }, ({ query }) => listMaterials(query)));

adminRouter.get(
  '/materials/:materialId/file',
  handler({ params: adminMaterialParams }, async ({ auth, params, req, res }) => {
    const { material, file } = await openMaterialFileAsAdmin(auth.userId, params.materialId, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    await streamPdf(res, file, material.originalFilename);
  }),
);

adminRouter.get('/activity', handler({ query: activityQuery }, ({ query }) => listActivity(query)));
adminRouter.get('/activity/types', handler({}, () => ({ items: listActivityTypes() })));

adminRouter.get('/system/health', handler({}, () => getSystemHealth()));
