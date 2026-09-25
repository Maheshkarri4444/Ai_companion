import { Types } from 'mongoose';
import { enqueueJob, cancelQueuedJobs } from '../../jobs/queue';
import { AppError } from '../../lib/errors';
import { toObjectId } from '../../lib/validation';
import { Job } from '../../models/job.model';
import { Chunk, Concept, MaterialPage } from '../../models/knowledge.model';
import { Material, type IMaterial } from '../../models/material.model';
import { recordEvent } from '../activity/activity.service';
import { getOwnedMaterial } from '../materials/materials.service';
import { getOwnedProject } from '../projects/projects.service';
import { toMaterialDto } from '../serializers';
import { detachMaterialFromConcepts } from './concepts';

type MaterialRef = Pick<IMaterial, '_id' | 'ownerId' | 'projectId'> & { processing?: { version?: number } };

export const materialJobKey = (materialId: string, version: number) => `material.process:${materialId}:v${version}`;

/** Idempotent per material version: a duplicate call (event replay, reconciler) never starts duplicate work. */
export async function enqueueMaterialProcessing(material: MaterialRef) {
  const version = material.processing?.version ?? 1;
  return enqueueJob({
    type: 'material.process',
    idempotencyKey: materialJobKey(material._id.toString(), version),
    payload: { materialId: material._id.toString(), version },
    ownerId: material.ownerId,
    projectId: material.projectId,
    maxAttempts: 4,
    priority: 1,
  });
}

/** Learner-initiated retry of a failed material: new version, resumes from the last completed stage. */
export async function retryMaterialProcessing(ownerId: string, projectId: string, materialId: string) {
  const { project, material } = await getOwnedMaterial(ownerId, projectId, materialId);
  if (material.status !== 'failed') {
    throw AppError.conflict('NOT_RETRYABLE', 'Only materials whose processing failed can be retried.');
  }
  const updated = await Material.findOneAndUpdate(
    { _id: material._id, ownerId: project.ownerId, status: 'failed' },
    {
      $set: { status: 'queued', 'processing.stage': null, 'processing.progress': 0, 'processing.error': null },
      $inc: { 'processing.version': 1 },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw AppError.conflict('NOT_RETRYABLE', 'This material is already being processed.');
  await enqueueMaterialProcessing(updated);
  await recordEvent({
    type: 'material.reprocessed',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    materialId: material._id,
    metadata: { materialTitle: material.title, projectName: project.name },
  });
  return toMaterialDto(updated);
}

/** Removes everything derived from a material (pages, chunks, concept links) and cancels pending jobs. */
export async function deleteMaterialKnowledge(material: Pick<IMaterial, '_id' | 'ownerId' | 'projectId'>) {
  await cancelQueuedJobs({ type: 'material.process', 'payload.materialId': material._id.toString() });
  await MaterialPage.deleteMany({ materialId: material._id });
  await Chunk.deleteMany({ materialId: material._id });
  await detachMaterialFromConcepts(material.ownerId, material.projectId, material._id);
}

/** Everything derived for a whole Project (used by the cascade). */
export async function deleteProjectKnowledge(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  await cancelQueuedJobs({ projectId });
  await Promise.all([
    MaterialPage.deleteMany({ ownerId, projectId }),
    Chunk.deleteMany({ ownerId, projectId }),
    Concept.deleteMany({ ownerId, projectId }),
  ]);
}

export async function listProjectConcepts(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const concepts = await Concept.find({ ownerId: project.ownerId, projectId: project._id })
    .sort({ importance: -1, chunkCount: -1, name: 1 })
    .limit(200)
    .lean();
  const materialIds = [...new Set(concepts.flatMap((c) => c.sources.map((s) => s.materialId.toString())))];
  const materials = await Material.find({ _id: { $in: materialIds.map(toObjectId) } }, { title: 1 }).lean();
  const titleOf = new Map(materials.map((m) => [m._id.toString(), m.title]));
  return concepts.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    description: c.description,
    importance: c.importance,
    chunkCount: c.chunkCount,
    sources: c.sources.map((s) => ({
      materialId: s.materialId.toString(),
      materialTitle: titleOf.get(s.materialId.toString()) ?? 'Material',
      pages: s.pages,
    })),
  }));
}

export async function getMaterialPage(ownerId: string, projectId: string, materialId: string, pageNumber: number) {
  const { material } = await getOwnedMaterial(ownerId, projectId, materialId);
  const page = await MaterialPage.findOne({ materialId: material._id, ownerId: material.ownerId, pageNumber }).lean();
  if (!page) throw AppError.notFound('Page');
  return {
    materialId: material._id.toString(),
    materialTitle: material.title,
    pageNumber: page.pageNumber,
    pageCount: material.pageCount,
    method: page.method,
    sectionTitle: page.sectionTitle,
    text: page.text,
  };
}

/**
 * Reconciler (runs every minute): repairs state a crash may have left behind — queued materials without a
 * live job are re-enqueued; materials stuck in "processing" with no running job are requeued.
 */
export async function reconcileMaterials(): Promise<{ requeued: number }> {
  const cutoff = new Date(Date.now() - 30_000);
  const candidates = await Material.find(
    { status: { $in: ['queued', 'processing'] }, updatedAt: { $lt: cutoff } },
    { ownerId: 1, projectId: 1, processing: 1, status: 1 },
  )
    .limit(200)
    .lean();
  let requeued = 0;
  for (const material of candidates) {
    const key = materialJobKey(material._id.toString(), material.processing?.version ?? 1);
    const job = await Job.findOne({ idempotencyKey: key }, { status: 1 }).lean();
    if (!job) {
      const { created } = await enqueueMaterialProcessing(material);
      if (created) requeued++;
    } else if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'succeeded') {
      // The job finished but the material never reflected it: surface a retryable failure.
      await Material.updateOne(
        { _id: material._id, status: { $in: ['queued', 'processing'] } },
        {
          $set: {
            status: 'failed',
            'processing.error': { code: 'RECONCILED', message: 'Processing was interrupted. Please retry.', retryable: true },
          },
        },
      );
    }
  }
  return { requeued };
}

export const objectId = (id: string) => new Types.ObjectId(id);
