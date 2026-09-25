import { Router } from 'express';
import { handler } from '../../lib/handler';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { streamPdf } from '../materials/pdf';
import {
  activityQuery,
  adminMaterialParams,
  aiCallsQuery,
  evaluationsQuery,
  idParams,
  jobsQuery,
  materialsQuery,
  projectsQuery,
  rangeQuery,
  spacesQuery,
  userParams,
  usersQuery,
} from './admin.schemas';
import {
  getAiCall,
  getAiConfiguration,
  getAiOverview,
  getEvalRun,
  getEvaluationOverview,
  listAiCalls,
  listEvaluations,
} from './ai-admin.service';
import { getJob, getJobsOverview, listJobs, retryJobAsAdmin } from './jobs-admin.service';
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

// AI usage & tracing (PRD §14: model, feature, latency, tokens, cost, failures, retrieval)
adminRouter.get('/ai/overview', handler({ query: rangeQuery }, ({ query }) => getAiOverview(query)));
adminRouter.get('/ai/config', handler({}, () => getAiConfiguration()));
adminRouter.get('/ai/calls', handler({ query: aiCallsQuery }, ({ query }) => listAiCalls(query)));
adminRouter.get('/ai/calls/:callId', handler({ params: idParams('callId') }, ({ params }) => getAiCall(params.callId as string)));

// AI quality: rules, LLM judge, learner feedback, offline regression runs
adminRouter.get('/ai/evaluations/overview', handler({ query: rangeQuery }, ({ query }) => getEvaluationOverview(query)));
adminRouter.get('/ai/evaluations', handler({ query: evaluationsQuery }, ({ query }) => listEvaluations(query)));
adminRouter.get('/ai/eval-runs/:runId', handler({ params: idParams('runId') }, ({ params }) => getEvalRun(params.runId as string)));

// Background processing
adminRouter.get('/jobs/overview', handler({}, () => getJobsOverview()));
adminRouter.get('/jobs', handler({ query: jobsQuery }, ({ query }) => listJobs(query)));
adminRouter.get('/jobs/:jobId', handler({ params: idParams('jobId') }, ({ params }) => getJob(params.jobId as string)));
adminRouter.post(
  '/jobs/:jobId/retry',
  handler({ params: idParams('jobId') }, async ({ auth, params, req }) => ({
    job: await retryJobAsAdmin(auth.userId, params.jobId as string, { ip: req.ip, userAgent: req.get('user-agent') }),
  })),
);
