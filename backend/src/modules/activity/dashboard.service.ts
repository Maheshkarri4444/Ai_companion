import { toObjectId } from '../../lib/validation';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { materialTotals } from '../aggregates';
import { listRecentProjects } from '../projects/projects.service';
import { projectNextStep, type NextStep } from '../workspace';
import { listUserActivity } from './activity.service';

/**
 * Home dashboard: "where was I, how am I doing, what should I do next?" (PRD §16).
 * Phase 1 answers with workspace state; mastery, attention areas and AI recommendations join in Phase 5.
 */
export async function getHomeDashboard(ownerId: string) {
  const owner = toObjectId(ownerId);
  const [spaceCount, projectCount, totals, recentProjects, recentActivity] = await Promise.all([
    Space.countDocuments({ ownerId: owner }),
    Project.countDocuments({ ownerId: owner }),
    materialTotals({ ownerId: owner }),
    listRecentProjects(ownerId, 6),
    listUserActivity(ownerId, { limit: 8 }),
  ]);

  return {
    stats: {
      spaceCount,
      projectCount,
      materialCount: totals.count,
      totalBytes: totals.totalBytes,
      materialsByStatus: totals.byStatus,
    },
    continueLearning: recentProjects[0] ?? null,
    recentProjects,
    recentActivity,
    nextStep: await computeNextStep(owner),
  };
}

/** Follows the most recent work: newest Space without Projects, otherwise the most recent Project's state. */
async function computeNextStep(owner: ReturnType<typeof toObjectId>): Promise<NextStep> {
  const latestSpace = await Space.findOne({ ownerId: owner }).sort({ lastActivityAt: -1 }).lean();
  if (!latestSpace) return { kind: 'create_space' };

  const latestSpaceHasProjects = await Project.exists({ ownerId: owner, spaceId: latestSpace._id });
  if (!latestSpaceHasProjects) {
    return { kind: 'create_project', spaceId: latestSpace._id.toString(), spaceName: latestSpace.name };
  }

  const latestProject = await Project.findOne({ ownerId: owner }).sort({ lastActivityAt: -1 }).lean();
  if (!latestProject) {
    return { kind: 'create_project', spaceId: latestSpace._id.toString(), spaceName: latestSpace.name };
  }

  const byStatus = { queued: 0, processing: 0, ready: 0, failed: 0 };
  const rows = await Material.aggregate<{ _id: keyof typeof byStatus; n: number }>([
    { $match: { ownerId: owner, projectId: latestProject._id } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  for (const row of rows) byStatus[row._id] = row.n;
  return projectNextStep(latestProject, byStatus);
}
