import type { Types } from 'mongoose';
import type { IActivityEvent } from '../models/activityEvent.model';
import type { IMaterial, MaterialStatus } from '../models/material.model';
import type { IProject } from '../models/project.model';
import type { ISpace } from '../models/space.model';
import type { IUser } from '../models/user.model';

/**
 * Explicit DTO mapping: the API never serialises raw documents, so internal fields
 * (password hashes, storage ids, hashes) cannot leak by accident.
 */

export const idOf = (value: Types.ObjectId | null | undefined) => (value ? value.toString() : null);

export type StatusCounts = Record<MaterialStatus, number>;
export const emptyStatusCounts = (): StatusCounts => ({ queued: 0, processing: 0, ready: 0, failed: 0 });

export function toUserDto(
  user: Pick<IUser, '_id' | 'name' | 'email' | 'role' | 'status' | 'createdAt' | 'lastLoginAt' | 'lastActiveAt'>,
) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    lastActiveAt: user.lastActiveAt ?? null,
  };
}

export function toSpaceDto(space: ISpace, counts: { projectCount?: number; materialCount?: number } = {}) {
  return {
    id: space._id.toString(),
    name: space.name,
    description: space.description,
    color: space.color,
    icon: space.icon,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
    lastActivityAt: space.lastActivityAt,
    projectCount: counts.projectCount ?? 0,
    materialCount: counts.materialCount ?? 0,
  };
}

export function toSpaceSummary(space: Pick<ISpace, '_id' | 'name' | 'color' | 'icon'>) {
  return { id: space._id.toString(), name: space.name, color: space.color, icon: space.icon };
}

export function toProjectDto(project: IProject, materialCounts: StatusCounts = emptyStatusCounts()) {
  const materialCount = Object.values(materialCounts).reduce((sum, n) => sum + n, 0);
  return {
    id: project._id.toString(),
    spaceId: project.spaceId.toString(),
    name: project.name,
    description: project.description,
    learningGoal: project.learningGoal,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastActivityAt: project.lastActivityAt,
    materialCount,
    materialStatusCounts: materialCounts,
  };
}

export function toMaterialDto(material: IMaterial) {
  return {
    id: material._id.toString(),
    projectId: material.projectId.toString(),
    spaceId: material.spaceId.toString(),
    title: material.title,
    originalFilename: material.originalFilename,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
    status: material.status,
    pageCount: material.pageCount ?? null,
    processing: {
      stage: material.processing?.stage ?? null,
      progress: material.processing?.progress ?? 0,
      attempts: material.processing?.attempts ?? 0,
      startedAt: material.processing?.startedAt ?? null,
      finishedAt: material.processing?.finishedAt ?? null,
      error: material.processing?.error
        ? {
            code: material.processing.error.code,
            message: material.processing.error.message,
            retryable: Boolean(material.processing.error.retryable),
          }
        : null,
    },
    summary: material.summary ?? null,
    stats: {
      chunkCount: material.stats?.chunkCount ?? 0,
      conceptCount: material.stats?.conceptCount ?? 0,
      ocrPageCount: material.stats?.ocrPageCount ?? 0,
    },
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

export function toActivityDto(event: IActivityEvent) {
  return {
    id: event._id.toString(),
    type: event.type,
    ownerId: event.ownerId.toString(),
    actorId: idOf(event.actorId),
    spaceId: idOf(event.spaceId),
    projectId: idOf(event.projectId),
    materialId: idOf(event.materialId),
    metadata: event.metadata ?? {},
    createdAt: event.createdAt,
  };
}
