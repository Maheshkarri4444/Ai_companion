import { AppError } from '../../lib/errors';
import { toObjectId } from '../../lib/validation';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { listUserActivity, recordEvent } from '../activity/activity.service';
import { materialStatusByProject, materialTotals } from '../aggregates';
import { deleteProjectData } from '../cascade/cascade.service';
import { emptyStatusCounts, toMaterialDto, toProjectDto, toSpaceSummary } from '../serializers';
import { getOwnedSpace } from '../spaces/spaces.service';
import { projectNextStep, touchActivity, tutorStateFor } from '../workspace';
import type { CreateProjectInput, UpdateProjectInput } from './projects.schemas';

/** Ownership-scoped lookup: another user's Project is indistinguishable from a missing one (404). */
export async function getOwnedProject(ownerId: string, projectId: string) {
  const project = await Project.findOne({ _id: toObjectId(projectId), ownerId: toObjectId(ownerId) }).lean();
  if (!project) throw AppError.notFound('Project');
  return project;
}

export async function listProjects(ownerId: string, spaceId: string) {
  const space = await getOwnedSpace(ownerId, spaceId);
  const projects = await Project.find({ ownerId: space.ownerId, spaceId: space._id }).sort({ lastActivityAt: -1 }).lean();
  const statusByProject = await materialStatusByProject(projects.map((p) => p._id));
  return projects.map((p) => toProjectDto(p, statusByProject.get(p._id.toString()) ?? emptyStatusCounts()));
}

export async function createProject(ownerId: string, spaceId: string, input: CreateProjectInput) {
  const space = await getOwnedSpace(ownerId, spaceId);
  const project = await Project.create({
    ...input,
    ownerId: space.ownerId,
    spaceId: space._id,
    lastActivityAt: new Date(),
  });
  await touchActivity({ spaceId: space._id });
  await recordEvent({
    type: 'project.created',
    ownerId,
    spaceId: space._id,
    projectId: project._id,
    metadata: { projectName: project.name, spaceName: space.name },
  });
  return toProjectDto(project.toObject());
}

export async function listRecentProjects(ownerId: string, limit: number) {
  const owner = toObjectId(ownerId);
  const projects = await Project.find({ ownerId: owner }).sort({ lastActivityAt: -1 }).limit(limit).lean();
  const [spaces, statusByProject] = await Promise.all([
    Space.find({ ownerId: owner, _id: { $in: projects.map((p) => p.spaceId) } }, { name: 1, color: 1, icon: 1 }).lean(),
    materialStatusByProject(projects.map((p) => p._id)),
  ]);
  const spaceById = new Map(spaces.map((s) => [s._id.toString(), s]));
  return projects.map((p) => {
    const space = spaceById.get(p.spaceId.toString());
    return {
      ...toProjectDto(p, statusByProject.get(p._id.toString()) ?? emptyStatusCounts()),
      space: space ? toSpaceSummary(space) : null,
    };
  });
}

export async function getProjectDashboard(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const [space, totals, recentMaterials, recentActivity, tutor] = await Promise.all([
    Space.findOne({ _id: project.spaceId, ownerId: project.ownerId }, { name: 1, color: 1, icon: 1 }).lean(),
    materialTotals({ ownerId: project.ownerId, projectId: project._id }),
    Material.find({ ownerId: project.ownerId, projectId: project._id }).sort({ createdAt: -1 }).limit(5).lean(),
    listUserActivity(ownerId, { projectId, limit: 10 }),
    tutorStateFor(project),
  ]);

  return {
    project: toProjectDto(project, totals.byStatus),
    space: space ? toSpaceSummary(space) : null,
    stats: {
      materialCount: totals.count,
      totalBytes: totals.totalBytes,
      totalPages: totals.totalPages,
      materialsByStatus: totals.byStatus,
    },
    recentMaterials: recentMaterials.map(toMaterialDto),
    recentActivity,
    nextStep: projectNextStep(project, totals.byStatus, tutor),
  };
}

export async function updateProject(ownerId: string, projectId: string, patch: UpdateProjectInput) {
  const project = await Project.findOneAndUpdate(
    { _id: toObjectId(projectId), ownerId: toObjectId(ownerId) },
    { $set: { ...patch, lastActivityAt: new Date() } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!project) throw AppError.notFound('Project');
  await touchActivity({ spaceId: project.spaceId });
  await recordEvent({
    type: 'project.updated',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: { projectName: project.name, changes: Object.keys(patch) },
  });
  const counts = await materialStatusByProject([project._id]);
  return toProjectDto(project, counts.get(project._id.toString()) ?? emptyStatusCounts());
}

export async function deleteProject(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const removed = await deleteProjectData(project);
  await touchActivity({ spaceId: project.spaceId });
  await recordEvent({
    type: 'project.deleted',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: { projectName: project.name, ...removed },
  });
}
