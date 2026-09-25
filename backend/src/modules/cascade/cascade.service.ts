import type { Types } from 'mongoose';
import { logger } from '../../lib/logger';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { storage } from '../../storage/storage';

/**
 * The single place that knows everything a Project owns. Every phase that adds a project-scoped
 * collection must extend `deleteProjectData` (see docs/ARCHITECTURE.md §7 conventions).
 *
 * Order: documents first, file blobs last. A crash midway can leave an orphaned blob (invisible,
 * sweepable) but never a visible record pointing at a deleted file.
 */
export async function deleteProjectData(project: { _id: Types.ObjectId; ownerId: Types.ObjectId }) {
  const materials = await Material.find({ projectId: project._id, ownerId: project.ownerId }, { storage: 1 }).lean();

  await Material.deleteMany({ projectId: project._id, ownerId: project.ownerId });
  // Phase 2+: material_pages, chunks, concepts, jobs (cancel queued)
  // Phase 3+: conversations, messages · Phase 4+: quiz_sessions, questions, attempts, mastery, mastery_snapshots
  // Phase 5+: recommendations, learning_context
  await Project.deleteOne({ _id: project._id, ownerId: project.ownerId });

  await deleteBlobs(materials.map((m) => m.storage.fileId.toString()));
  return { materialCount: materials.length };
}

export async function deleteSpaceData(space: { _id: Types.ObjectId; ownerId: Types.ObjectId }) {
  const projects = await Project.find({ spaceId: space._id, ownerId: space.ownerId }, { _id: 1, ownerId: 1 }).lean();
  let materialCount = 0;
  for (const project of projects) {
    materialCount += (await deleteProjectData(project)).materialCount;
  }
  await Space.deleteOne({ _id: space._id, ownerId: space.ownerId });
  return { projectCount: projects.length, materialCount };
}

export async function deleteBlobs(fileIds: string[]) {
  const results = await Promise.allSettled(fileIds.map((id) => storage.delete(id)));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) logger.warn({ failed: failed.length }, 'Some stored files could not be deleted (orphaned blobs)');
}
