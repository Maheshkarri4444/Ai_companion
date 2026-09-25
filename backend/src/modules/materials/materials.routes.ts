import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { config } from '../../config/env';
import { AppError } from '../../lib/errors';
import { handler } from '../../lib/handler';
import { uploadRateLimit } from '../../middleware/rateLimits';
import { getOwnedProject } from '../projects/projects.service';
import { materialParams, projectScopeParams, updateMaterialBody, uploadFields } from './materials.schemas';
import {
  deleteMaterial,
  getOwnedMaterial,
  listMaterials,
  openMaterialFile,
  renameMaterial,
  uploadMaterial,
} from './materials.service';
import { streamPdf } from './pdf';
import { toMaterialDto } from '../serializers';

// Mounted under /api/projects/:projectId/materials (authentication applied by the parent router).
export const materialsRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, fieldSize: 2 * 1024 },
  defParamCharset: 'utf8', // non-ASCII filenames arrive intact instead of latin1-mangled
});

materialsRouter.get(
  '/',
  handler({ params: projectScopeParams }, async ({ auth, params }) => ({
    items: await listMaterials(auth.userId, params.projectId),
  })),
);

/** Reject before multer buffers the body: never accept bytes for a Project the caller does not own. */
const ensureProjectOwned: RequestHandler = async (req, _res, next) => {
  const params = projectScopeParams.safeParse(req.params);
  if (!params.success || !req.auth) throw AppError.notFound('Project');
  await getOwnedProject(req.auth.userId, params.data.projectId);
  next();
};

materialsRouter.post(
  '/',
  uploadRateLimit,
  ensureProjectOwned,
  upload.single('file'),
  handler({ params: projectScopeParams, body: uploadFields }, async ({ auth, params, body, req, res }) => {
    const material = await uploadMaterial(auth.userId, params.projectId, req.file, body.title);
    res.status(201);
    return { material };
  }),
);

materialsRouter.get(
  '/:materialId',
  handler({ params: materialParams }, async ({ auth, params }) => {
    const { material } = await getOwnedMaterial(auth.userId, params.projectId, params.materialId);
    return { material: toMaterialDto(material) };
  }),
);

materialsRouter.patch(
  '/:materialId',
  handler({ params: materialParams, body: updateMaterialBody }, async ({ auth, params, body }) => ({
    material: await renameMaterial(auth.userId, params.projectId, params.materialId, body.title),
  })),
);

materialsRouter.delete(
  '/:materialId',
  handler({ params: materialParams }, async ({ auth, params }) => {
    await deleteMaterial(auth.userId, params.projectId, params.materialId);
  }),
);

materialsRouter.get(
  '/:materialId/file',
  handler({ params: materialParams }, async ({ auth, params, res }) => {
    const { material, file } = await openMaterialFile(auth.userId, params.projectId, params.materialId);
    await streamPdf(res, file, material.originalFilename);
  }),
);
