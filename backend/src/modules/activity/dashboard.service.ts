import type { Types } from 'mongoose';
import { logger } from '../../lib/logger';
import { toObjectId } from '../../lib/validation';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { materialTotals } from '../aggregates';
import { combineSummaries } from '../analytics/analytics.service';
import { computeProjectGrowth } from '../growth/growth.service';
import { listRecentProjects } from '../projects/projects.service';
import { recommendationsFor, type RecommendationDto } from '../recommendations/recommendations.service';
import { projectNextStep, quizStateFor, tutorStateFor, type NextStep } from '../workspace';
import { listUserActivity } from './activity.service';

/**
 * Home dashboard: "where was I, how am I doing, what should I do next?" (PRD §16) — continue learning, recent
 * Projects, overall progress, areas requiring attention and the recommended next action.
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

  const learning = await learningOverview(owner).catch((err) => {
    // The dashboard must render even if an analytics query fails.
    logger.warn({ err: (err as Error).message }, 'Home learning overview failed');
    return { progress: null, attention: [], recommendation: null };
  });

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
    progress: learning.progress,
    attention: learning.attention,
    recommendation: learning.recommendation,
    nextStep: await computeNextStep(owner),
  };
}

type AttentionArea = {
  projectId: string;
  projectName: string;
  conceptId: string;
  name: string;
  mastery: number | null;
  reasons: string[];
  severity: number;
};

/**
 * Overall progress and the areas requiring attention over a set of Projects (7-day growth window): the Home
 * dashboard uses the six most recent Projects, a Space dashboard the Projects inside it.
 */
async function progressOverview(owner: ReturnType<typeof toObjectId>, projects: Array<{ _id: Types.ObjectId; name: string }>, now = new Date()) {
  const growths = await Promise.all(projects.map((p) => computeProjectGrowth(owner, p._id, 7, now)));
  const summaries = growths.map((g) => g.summary);
  const combined = combineSummaries(summaries);
  const answersThisWeek = summaries.reduce((n, s) => n + s.answersInWindow, 0);
  const attention: AttentionArea[] = growths
    .flatMap((g, i) =>
      g.concepts
        .filter((c) => c.status === 'attention')
        .map((c) => ({
          projectId: projects[i]._id.toString(),
          projectName: projects[i].name,
          conceptId: c.conceptId,
          name: c.name,
          mastery: c.mastery,
          reasons: c.reasonText,
          severity: c.severity,
        })),
    )
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 5);
  return {
    progress: { ...combined, improving: growths.reduce((n, g) => n + g.summary.counts.improving, 0), answersThisWeek },
    attention,
    perProject: projects.map((p, i) => ({
      projectId: p._id.toString(),
      overallMastery: summaries[i].overallMastery,
      assessedConcepts: summaries[i].assessedConcepts,
      totalConcepts: summaries[i].totalConcepts,
      needsAttention: summaries[i].counts.attention,
      improving: summaries[i].counts.improving,
    })),
  };
}

/** Overall progress, the weakest areas across recent Projects, and the top recommendation of the latest one. */
async function learningOverview(owner: ReturnType<typeof toObjectId>) {
  const projects = await Project.find({ ownerId: owner }).sort({ lastActivityAt: -1 }).limit(6).lean();
  const { progress, attention } = await progressOverview(owner, projects);

  // The recommendation follows the most recent Project that has something to recommend.
  let recommendation: (RecommendationDto & { projectName: string }) | null = null;
  for (const project of projects.slice(0, 3)) {
    const [top] = await recommendationsFor(project);
    if (top) {
      recommendation = { ...top, projectName: project.name };
      break;
    }
  }
  return { progress, attention, recommendation };
}

/** A Space dashboard's learning view (PRD §4): progress and areas requiring attention across its Projects. */
export async function getSpaceLearning(ownerId: string, spaceId: string) {
  const owner = toObjectId(ownerId);
  const projects = await Project.find({ ownerId: owner, spaceId: toObjectId(spaceId) }, { name: 1 }).sort({ lastActivityAt: -1 }).limit(12).lean();
  if (!projects.length) return { progress: null, attention: [], projectProgress: [] };
  try {
    const { progress, attention, perProject } = await progressOverview(owner, projects);
    return { progress, attention, projectProgress: perProject };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Space learning overview failed');
    return { progress: null, attention: [], projectProgress: [] };
  }
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
  const [tutor, quiz] = await Promise.all([tutorStateFor(latestProject), quizStateFor(latestProject)]);
  return projectNextStep(latestProject, byStatus, tutor, quiz);
}
