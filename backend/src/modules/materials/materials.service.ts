import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError, isDuplicateKeyError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { toObjectId } from '../../lib/validation';
import { Material } from '../../models/material.model';
import { storage } from '../../storage/storage';
import { recordEvent } from '../activity/activity.service';
import { deleteBlobs } from '../cascade/cascade.service';
import { getOwnedProject } from '../projects/projects.service';
import { toMaterialDto } from '../serializers';
import { touchActivity } from '../workspace';
import { assertPdf, sanitizeFilename, titleFromFilename } from './pdf';

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Resolves through the owned Project, so a material is only reachable by the owner of its Project. */
export async function getOwnedMaterial(ownerId: string, projectId: string, materialId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const material = await Material.findOne({
    _id: toObjectId(materialId),
    projectId: project._id,
    ownerId: project.ownerId,
  }).lean();
  if (!material) throw AppError.notFound('Material');
  return { project, material };
}

export async function listMaterials(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const materials = await Material.find({ projectId: project._id, ownerId: project.ownerId }).sort({ createdAt: -1 }).lean();
  return materials.map(toMaterialDto);
}

/**
 * Upload is deliberately fast: validate, deduplicate, store, record as `queued`. All heavy work
 * (extraction, OCR, chunking, embeddings) happens in the background pipeline (docs/ARCHITECTURE.md §9).
 */
export async function uploadMaterial(ownerId: string, projectId: string, file: UploadedFile | undefined, title?: string) {
  if (!file) throw AppError.badRequest('Attach a PDF in the "file" field.', undefined, 'FILE_REQUIRED');
  const project = await getOwnedProject(ownerId, projectId);
  assertPdf(file);

  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const duplicate = await Material.findOne({ projectId: project._id, sha256 }, { title: 1 }).lean();
  if (duplicate) {
    throw AppError.conflict('DUPLICATE_MATERIAL', `This file is already in the project as "${duplicate.title}".`, {
      materialId: duplicate._id.toString(),
    });
  }

  const originalFilename = sanitizeFilename(file.originalname);
  const materialId = new Types.ObjectId();
  const stored = await storage.save({
    buffer: file.buffer,
    filename: originalFilename,
    metadata: { ownerId: project.ownerId, projectId: project._id, materialId, sha256, contentType: 'application/pdf' },
  });

  let material;
  try {
    material = await Material.create({
      _id: materialId,
      ownerId: project.ownerId,
      spaceId: project.spaceId,
      projectId: project._id,
      title: title ?? titleFromFilename(originalFilename),
      originalFilename,
      mimeType: 'application/pdf',
      sizeBytes: stored.sizeBytes,
      sha256,
      storage: { provider: 'gridfs', fileId: new Types.ObjectId(stored.fileId) },
      status: 'queued',
    });
  } catch (err) {
    // Never leave an orphaned blob behind; a concurrent identical upload loses on the unique index.
    await storage.delete(stored.fileId).catch((e) => logger.warn({ err: e }, 'Failed to remove orphaned upload'));
    if (isDuplicateKeyError(err)) throw AppError.conflict('DUPLICATE_MATERIAL', 'This file is already in the project.');
    throw err;
  }

  await touchActivity({ spaceId: project.spaceId, projectId: project._id });
  await recordEvent({
    type: 'material.uploaded',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    materialId: material._id,
    metadata: { materialTitle: material.title, projectName: project.name, sizeBytes: material.sizeBytes },
  });
  // Phase 2: the `material.uploaded` subscription enqueues the `material.process` job here.
  return toMaterialDto(material.toObject());
}

export async function renameMaterial(ownerId: string, projectId: string, materialId: string, title: string) {
  const { project, material } = await getOwnedMaterial(ownerId, projectId, materialId);
  const updated = await Material.findOneAndUpdate(
    { _id: material._id, ownerId: project.ownerId },
    { $set: { title } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw AppError.notFound('Material');
  await recordEvent({
    type: 'material.updated',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    materialId: material._id,
    metadata: { materialTitle: updated.title, previousTitle: material.title, projectName: project.name },
  });
  return toMaterialDto(updated);
}

export async function deleteMaterial(ownerId: string, projectId: string, materialId: string) {
  const { project, material } = await getOwnedMaterial(ownerId, projectId, materialId);
  await Material.deleteOne({ _id: material._id, ownerId: project.ownerId });
  // Phase 2+: derived pages/chunks/concept links for this material are removed here as well.
  await deleteBlobs([material.storage.fileId.toString()]);
  await touchActivity({ spaceId: project.spaceId, projectId: project._id });
  await recordEvent({
    type: 'material.deleted',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    materialId: material._id,
    metadata: { materialTitle: material.title, projectName: project.name },
  });
}

export async function openMaterialFile(ownerId: string, projectId: string, materialId: string) {
  const { material } = await getOwnedMaterial(ownerId, projectId, materialId);
  const file = await storage.open(material.storage.fileId.toString());
  if (!file) throw AppError.notFound('File');
  return { material, file };
}
