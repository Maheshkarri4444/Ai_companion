import { AppError } from '../../lib/errors';
import { toObjectId } from '../../lib/validation';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { listUserActivity, recordEvent } from '../activity/activity.service';
import { materialCountsBySpace, materialStatusByProject, materialTotals, projectCountsBySpace } from '../aggregates';
import { deleteSpaceData } from '../cascade/cascade.service';
import { emptyStatusCounts, toProjectDto, toSpaceDto } from '../serializers';
import type { CreateSpaceInput, UpdateSpaceInput } from './spaces.schemas';

/** Ownership-scoped lookup: another user's Space is indistinguishable from a missing one (404). */
export async function getOwnedSpace(ownerId: string, spaceId: string) {
  const space = await Space.findOne({ _id: toObjectId(spaceId), ownerId: toObjectId(ownerId) }).lean();
  if (!space) throw AppError.notFound('Space');
  return space;
}

async function spaceCounts(spaceId: ReturnType<typeof toObjectId>) {
  const [projects, materials] = await Promise.all([
    projectCountsBySpace([spaceId]),
    materialCountsBySpace([spaceId]),
  ]);
  const key = spaceId.toString();
  return { projectCount: projects.get(key) ?? 0, materialCount: materials.get(key) ?? 0 };
}

export async function listSpaces(ownerId: string) {
  const spaces = await Space.find({ ownerId: toObjectId(ownerId) }).sort({ lastActivityAt: -1 }).lean();
  const ids = spaces.map((s) => s._id);
  const [projectCounts, materialCounts] = await Promise.all([projectCountsBySpace(ids), materialCountsBySpace(ids)]);
  return spaces.map((space) => {
    const key = space._id.toString();
    return toSpaceDto(space, {
      projectCount: projectCounts.get(key) ?? 0,
      materialCount: materialCounts.get(key) ?? 0,
    });
  });
}

export async function createSpace(ownerId: string, input: CreateSpaceInput) {
  const space = await Space.create({ ...input, ownerId: toObjectId(ownerId), lastActivityAt: new Date() });
  await recordEvent({ type: 'space.created', ownerId, spaceId: space._id, metadata: { spaceName: space.name } });
  return toSpaceDto(space.toObject());
}

export async function getSpaceDashboard(ownerId: string, spaceId: string) {
  const space = await getOwnedSpace(ownerId, spaceId);
  const projects = await Project.find({ ownerId: space.ownerId, spaceId: space._id }).sort({ lastActivityAt: -1 }).lean();
  const [statusByProject, totals, recentActivity] = await Promise.all([
    materialStatusByProject(projects.map((p) => p._id)),
    materialTotals({ ownerId: space.ownerId, spaceId: space._id }),
    listUserActivity(ownerId, { spaceId, limit: 10 }),
  ]);

  return {
    space: toSpaceDto(space, { projectCount: projects.length, materialCount: totals.count }),
    projects: projects.map((p) => toProjectDto(p, statusByProject.get(p._id.toString()) ?? emptyStatusCounts())),
    stats: {
      projectCount: projects.length,
      materialCount: totals.count,
      totalBytes: totals.totalBytes,
      materialsByStatus: totals.byStatus,
    },
    recentActivity,
  };
}

export async function updateSpace(ownerId: string, spaceId: string, patch: UpdateSpaceInput) {
  const space = await Space.findOneAndUpdate(
    { _id: toObjectId(spaceId), ownerId: toObjectId(ownerId) },
    { $set: { ...patch, lastActivityAt: new Date() } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!space) throw AppError.notFound('Space');
  await recordEvent({
    type: 'space.updated',
    ownerId,
    spaceId: space._id,
    metadata: { spaceName: space.name, changes: Object.keys(patch) },
  });
  return toSpaceDto(space, await spaceCounts(space._id));
}

export async function deleteSpace(ownerId: string, spaceId: string) {
  const space = await getOwnedSpace(ownerId, spaceId);
  const removed = await deleteSpaceData(space);
  await recordEvent({
    type: 'space.deleted',
    ownerId,
    spaceId: space._id,
    metadata: { spaceName: space.name, ...removed },
  });
}
