import type { Types } from 'mongoose';
import { config } from '../../config/env';
import { getDb, pingDatabase } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { escapeRegex, toObjectId, type Paginated } from '../../lib/validation';
import { ACTIVITY_TYPES, ActivityEvent, type IActivityEvent } from '../../models/activityEvent.model';
import { AuditLog } from '../../models/auditLog.model';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { Space } from '../../models/space.model';
import { User } from '../../models/user.model';
import { ai } from '../../ai';
import { AiCall } from '../../models/aiCall.model';
import { Conversation } from '../../models/conversation.model';
import { Chunk, Concept } from '../../models/knowledge.model';
import { Job } from '../../models/job.model';
import { LearningContext } from '../../models/learningContext.model';
import { Mastery } from '../../models/mastery.model';
import { Attempt, QuizSession } from '../../models/quiz.model';
import { Recommendation } from '../../models/recommendation.model';
import { storage } from '../../storage/storage';
import { activeDaySet, streaks } from '../analytics/analytics.service';
import { computeProjectGrowth } from '../growth/growth.service';
import { masteryOf, masterySummary } from '../mastery/estimator';
import { vectorIndexState } from '../knowledge/vector-index';
import { aiUsageForUser } from './ai-admin.service';
import { getWorkerStatus } from './jobs-admin.service';
import {
  materialCountsBySpace,
  materialStatusByProject,
  materialTotals,
  projectCountsBySpace,
} from '../aggregates';
import {
  emptyStatusCounts,
  toActivityDto,
  toMaterialDto,
  toProjectDto,
  toSpaceDto,
  toSpaceSummary,
  toUserDto,
} from '../serializers';
import type { ActivityQuery, MaterialsQuery, ProjectsQuery, SpacesQuery, UsersQuery } from './admin.schemas';

/*
 * Admin services are the only code allowed to read across tenants (docs/ARCHITECTURE.md §5).
 * They are mounted exclusively behind requireRole('admin') and are read-only, except the audited file view.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } };

type UserRef = { id: string; name: string; email: string };

export async function userRefs(ids: Types.ObjectId[]): Promise<Map<string, UserRef>> {
  const unique = [...new Map(ids.filter(Boolean).map((id) => [id.toString(), id])).values()];
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }, { name: 1, email: 1 }).lean();
  return new Map(users.map((u) => [u._id.toString(), { id: u._id.toString(), name: u.name, email: u.email }]));
}

const containsRegex = (search: string) => ({ $regex: escapeRegex(search), $options: 'i' });
const skipFor = (page: number, limit: number) => (page - 1) * limit;

async function withUsers(events: IActivityEvent[]) {
  const refs = await userRefs(events.flatMap((e) => (e.actorId ? [e.ownerId, e.actorId] : [e.ownerId])));
  return events.map((event) => ({
    ...toActivityDto(event),
    user: refs.get(event.ownerId.toString()) ?? null,
    actor: event.actorId ? (refs.get(event.actorId.toString()) ?? null) : null,
  }));
}

/** Oldest → newest list of UTC day keys ('YYYY-MM-DD'). */
function lastDays(count: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) =>
    new Date(today.getTime() - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

export async function getOverview() {
  const now = Date.now();
  const since7d = new Date(now - 7 * DAY_MS);
  const since24h = new Date(now - DAY_MS);
  const days = lastDays(14);
  const seriesStart = new Date(`${days[0]}T00:00:00.000Z`);

  const [
    learners,
    admins,
    newLearners7d,
    activeLearners7d,
    spaceCount,
    projectCount,
    materials,
    events24h,
    eventSeries,
    signupSeries,
    topTypes,
    recentUsers,
    recentEvents,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'user', createdAt: { $gte: since7d } }),
    User.countDocuments({ role: 'user', lastActiveAt: { $gte: since7d } }),
    Space.countDocuments(),
    Project.countDocuments(),
    materialTotals({}),
    ActivityEvent.countDocuments({ createdAt: { $gte: since24h } }),
    ActivityEvent.aggregate<{ _id: string; events: number; activeUsers: number }>([
      { $match: { createdAt: { $gte: seriesStart } } },
      { $group: { _id: dayKey, events: { $sum: 1 }, users: { $addToSet: '$ownerId' } } },
      { $project: { events: 1, activeUsers: { $size: '$users' } } },
    ]),
    User.aggregate<{ _id: string; signups: number }>([
      { $match: { role: 'user', createdAt: { $gte: seriesStart } } },
      { $group: { _id: dayKey, signups: { $sum: 1 } } },
    ]),
    ActivityEvent.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since7d } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
    User.find({ role: 'user' }).sort({ createdAt: -1 }).limit(5).lean(),
    ActivityEvent.find({}).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const eventsByDay = new Map(eventSeries.map((row) => [row._id, row]));
  const signupsByDay = new Map(signupSeries.map((row) => [row._id, row.signups]));

  return {
    kpis: {
      learners,
      admins,
      newLearners7d,
      activeLearners7d,
      spaces: spaceCount,
      projects: projectCount,
      materials: materials.count,
      materialsByStatus: materials.byStatus,
      storageBytes: materials.totalBytes,
      events24h,
    },
    activitySeries: days.map((date) => ({
      date,
      events: eventsByDay.get(date)?.events ?? 0,
      activeUsers: eventsByDay.get(date)?.activeUsers ?? 0,
      signups: signupsByDay.get(date) ?? 0,
    })),
    topEventTypes: topTypes.map((row) => ({ type: row._id, count: row.count })),
    recentUsers: recentUsers.map(toUserDto),
    recentActivity: await withUsers(recentEvents),
  };
}

export async function listUsers(query: UsersQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = query.role;
  if (query.search) filter.$or = [{ name: containsRegex(query.search) }, { email: containsRegex(query.search) }];

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
  ]);
  const ids = users.map((u) => u._id);
  const [spaceRows, projectRows, materialRows] = await Promise.all([
    Space.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { ownerId: { $in: ids } } },
      { $group: { _id: '$ownerId', n: { $sum: 1 } } },
    ]),
    Project.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { ownerId: { $in: ids } } },
      { $group: { _id: '$ownerId', n: { $sum: 1 } } },
    ]),
    Material.aggregate<{ _id: Types.ObjectId; n: number; bytes: number }>([
      { $match: { ownerId: { $in: ids } } },
      { $group: { _id: '$ownerId', n: { $sum: 1 }, bytes: { $sum: '$sizeBytes' } } },
    ]),
  ]);
  const spaces = new Map(spaceRows.map((r) => [r._id.toString(), r.n]));
  const projects = new Map(projectRows.map((r) => [r._id.toString(), r.n]));
  const materials = new Map(materialRows.map((r) => [r._id.toString(), r]));

  return {
    items: users.map((u) => {
      const key = u._id.toString();
      return {
        ...toUserDto(u),
        counts: {
          spaces: spaces.get(key) ?? 0,
          projects: projects.get(key) ?? 0,
          materials: materials.get(key)?.n ?? 0,
          storageBytes: materials.get(key)?.bytes ?? 0,
        },
      };
    }),
    page: query.page,
    limit: query.limit,
    total,
  };
}

/** A learner's journey: profile, Spaces → Projects → materials, and their timeline. */
export async function getUserDetail(userId: string) {
  const user = await User.findById(toObjectId(userId)).lean();
  if (!user) throw AppError.notFound('User');
  const owner = user._id;

  const [spaces, projects, materials, totals, eventCount, recentEvents, aiUsage, conversationCount, memoryCount] = await Promise.all([
    Space.find({ ownerId: owner }).sort({ lastActivityAt: -1 }).lean(),
    Project.find({ ownerId: owner }).sort({ lastActivityAt: -1 }).lean(),
    Material.find({ ownerId: owner }).sort({ createdAt: -1 }).limit(100).lean(),
    materialTotals({ ownerId: owner }),
    ActivityEvent.countDocuments({ ownerId: owner }),
    ActivityEvent.find({ ownerId: owner }).sort({ createdAt: -1 }).limit(30).lean(),
    aiUsageForUser(owner),
    Conversation.countDocuments({ ownerId: owner }),
    LearningContext.countDocuments({ ownerId: owner, status: 'active' }),
  ]);
  const statusByProject = await materialStatusByProject(projects.map((p) => p._id));
  const projectName = new Map(projects.map((p) => [p._id.toString(), p.name]));
  const [assessments, growth] = await Promise.all([assessmentsForUser(owner, projectName), growthForUser(owner, projects, projectName)]);

  return {
    user: toUserDto(user),
    stats: {
      spaceCount: spaces.length,
      projectCount: projects.length,
      materialCount: totals.count,
      totalBytes: totals.totalBytes,
      materialsByStatus: totals.byStatus,
      eventCount,
      conversationCount,
      memoryCount,
    },
    aiUsage,
    assessments,
    growth,
    spaces: spaces.map((space) => {
      const own = projects.filter((p) => p.spaceId.equals(space._id));
      const projectDtos = own.map((p) => toProjectDto(p, statusByProject.get(p._id.toString()) ?? emptyStatusCounts()));
      return {
        ...toSpaceDto(space, {
          projectCount: own.length,
          materialCount: projectDtos.reduce((sum, p) => sum + p.materialCount, 0),
        }),
        projects: projectDtos,
      };
    }),
    materials: materials.map((m) => ({ ...toMaterialDto(m), projectName: projectName.get(m.projectId.toString()) ?? null })),
    recentActivity: recentEvents.map(toActivityDto),
  };
}

/** A learner's growth: learning streak, 7-day concept trends per Project, and how they respond to recommendations (PRD §9, §10). */
async function growthForUser(owner: Types.ObjectId, projects: Array<{ _id: Types.ObjectId }>, projectName: Map<string, string>) {
  const now = new Date();
  const DAY_MS = 86_400_000;
  const [days, recRows, active] = await Promise.all([
    activeDaySet({ ownerId: owner }, now),
    Recommendation.aggregate<{ _id: string; n: number }>([{ $match: { ownerId: owner } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Recommendation.find({ ownerId: owner, status: 'active' }).sort({ priority: -1 }).limit(6).lean(),
  ]);
  const since = new Date(now.getTime() - 29 * DAY_MS).toISOString().slice(0, 10);
  const byStatus = new Map(recRows.map((r) => [r._id, r.n]));
  const generated = recRows.reduce((n, r) => n + r.n, 0);
  const completed = byStatus.get('completed') ?? 0;
  const perProject = await Promise.all(
    projects.slice(0, 8).map(async (p) => {
      const g = await computeProjectGrowth(owner, p._id, 7, now);
      return {
        projectId: p._id.toString(),
        projectName: projectName.get(p._id.toString()) ?? null,
        counts: g.summary.counts,
        overallChange: g.summary.overallChange,
        attention: g.concepts
          .filter((c) => c.status === 'attention')
          .sort((a, b) => b.severity - a.severity)
          .slice(0, 3)
          .map((c) => ({ name: c.name, mastery: c.mastery, reasons: c.reasonText })),
      };
    }),
  );
  return {
    streak: streaks(days, now),
    activeDays30: [...days].filter((d) => d >= since).length,
    projects: perProject.filter((p) => p.counts.not_assessed < Object.values(p.counts).reduce((a, b) => a + b, 0)),
    recommendations: {
      generated,
      completed,
      dismissed: byStatus.get('dismissed') ?? 0,
      expired: byStatus.get('expired') ?? 0,
      actRate: generated ? Math.round((completed / generated) * 1000) / 1000 : null,
      active: active.map((r) => ({
        id: r._id.toString(),
        projectName: projectName.get(r.projectId.toString()) ?? null,
        kind: r.kind,
        title: r.title,
        source: r.source,
        createdAt: r.createdAt,
      })),
    },
  };
}

/** A learner's assessments and progress: quizzes, answer quality by type, grading health and mastery per Project. */
async function assessmentsForUser(owner: Types.ObjectId, projectName: Map<string, string>) {
  const [sessionRows, attemptRows, recent, masteries, concepts] = await Promise.all([
    QuizSession.aggregate<{ _id: string; n: number }>([{ $match: { ownerId: owner } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Attempt.aggregate<{ _id: { type: string; status: string }; n: number; correct: number; score: number }>([
      { $match: { ownerId: owner } },
      {
        $group: {
          _id: { type: '$type', status: '$grading.status' },
          n: { $sum: 1 },
          correct: { $sum: { $cond: ['$isCorrect', 1, 0] } },
          score: { $sum: { $ifNull: ['$outcome', 0] } },
        },
      },
    ]),
    QuizSession.find({ ownerId: owner, status: 'completed' }).sort({ completedAt: -1 }).limit(8).lean(),
    Mastery.find({ ownerId: owner }, { projectId: 1, conceptId: 1, theta: 1, evidenceCount: 1, lastPracticedAt: 1 }).lean(),
    Concept.find({ ownerId: owner }, { projectId: 1, name: 1, importance: 1 }).lean(),
  ]);
  const sessions = new Map(sessionRows.map((r) => [r._id, r.n]));
  const graded = attemptRows.filter((r) => r._id.status === 'graded');
  const answered = graded.reduce((n, r) => n + r.n, 0);
  const now = new Date();
  const masteryOfConcept = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  const byProject = new Map<string, Array<{ name: string; importance: number; mastery: number | null }>>();
  for (const c of concepts) {
    const list = byProject.get(c.projectId.toString()) ?? [];
    list.push({ name: c.name, importance: c.importance ?? 0.5, mastery: masteryOf(masteryOfConcept.get(c._id.toString()), now) });
    byProject.set(c.projectId.toString(), list);
  }
  return {
    quizzesCompleted: sessions.get('completed') ?? 0,
    quizzesActive: sessions.get('active') ?? 0,
    questionsAnswered: attemptRows.reduce((n, r) => n + r.n, 0),
    accuracy: answered ? Math.round((graded.reduce((n, r) => n + r.correct, 0) / answered) * 1000) / 1000 : null,
    avgScore: answered ? Math.round((graded.reduce((n, r) => n + r.score, 0) / answered) * 1000) / 1000 : null,
    byType: ['mcq', 'open'].map((type) => {
      const rows = graded.filter((r) => r._id.type === type);
      const n = rows.reduce((s, r) => s + r.n, 0);
      return { type, answered: n, avgScore: n ? Math.round((rows.reduce((s, r) => s + r.score, 0) / n) * 1000) / 1000 : null };
    }),
    grading: {
      pending: attemptRows.filter((r) => r._id.status === 'pending').reduce((n, r) => n + r.n, 0),
      failed: attemptRows.filter((r) => r._id.status === 'failed').reduce((n, r) => n + r.n, 0),
    },
    recentQuizzes: recent.map((s) => ({
      id: s._id.toString(),
      projectId: s.projectId.toString(),
      projectName: projectName.get(s.projectId.toString()) ?? null,
      mode: s.mode,
      completedAt: s.completedAt,
      answered: s.summary?.answered ?? s.answeredCount,
      correct: s.summary?.correct ?? s.correctCount,
      accuracy: s.summary?.accuracy ?? null,
      avgScore: s.summary?.avgScore ?? null,
      needsWork: s.summary?.needsWork ?? [],
    })),
    mastery: [...byProject.entries()]
      .map(([projectId, items]) => {
        const summary = masterySummary(items);
        const assessed = items.filter((i) => i.mastery !== null).sort((a, b) => (a.mastery as number) - (b.mastery as number));
        return {
          projectId,
          projectName: projectName.get(projectId) ?? null,
          ...summary,
          weakest: assessed.slice(0, 3).map((i) => ({ name: i.name, mastery: i.mastery })),
        };
      })
      .filter((p) => p.projectName !== null)
      .sort((a, b) => b.assessedConcepts - a.assessedConcepts),
  };
}

export async function listSpaces(query: SpacesQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  if (query.search) filter.$or = [{ name: containsRegex(query.search) }, { description: containsRegex(query.search) }];

  const [total, spaces] = await Promise.all([
    Space.countDocuments(filter),
    Space.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
  ]);
  const ids = spaces.map((s) => s._id);
  const [projectCounts, materialCounts, owners] = await Promise.all([
    projectCountsBySpace(ids),
    materialCountsBySpace(ids),
    userRefs(spaces.map((s) => s.ownerId)),
  ]);

  return {
    items: spaces.map((s) => ({
      ...toSpaceDto(s, {
        projectCount: projectCounts.get(s._id.toString()) ?? 0,
        materialCount: materialCounts.get(s._id.toString()) ?? 0,
      }),
      owner: owners.get(s.ownerId.toString()) ?? null,
    })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function listProjects(query: ProjectsQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  if (query.spaceId) filter.spaceId = toObjectId(query.spaceId);
  if (query.search) {
    const rx = containsRegex(query.search);
    filter.$or = [{ name: rx }, { description: rx }, { learningGoal: rx }];
  }

  const [total, projects] = await Promise.all([
    Project.countDocuments(filter),
    Project.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
  ]);
  const [statusByProject, owners, spaces] = await Promise.all([
    materialStatusByProject(projects.map((p) => p._id)),
    userRefs(projects.map((p) => p.ownerId)),
    Space.find({ _id: { $in: projects.map((p) => p.spaceId) } }, { name: 1, color: 1, icon: 1 }).lean(),
  ]);
  const spaceById = new Map(spaces.map((s) => [s._id.toString(), s]));

  return {
    items: projects.map((p) => {
      const space = spaceById.get(p.spaceId.toString());
      return {
        ...toProjectDto(p, statusByProject.get(p._id.toString()) ?? emptyStatusCounts()),
        owner: owners.get(p.ownerId.toString()) ?? null,
        space: space ? toSpaceSummary(space) : null,
      };
    }),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function listMaterials(query: MaterialsQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  if (query.spaceId) filter.spaceId = toObjectId(query.spaceId);
  if (query.projectId) filter.projectId = toObjectId(query.projectId);
  if (query.status) filter.status = query.status;
  if (query.search) filter.$or = [{ title: containsRegex(query.search) }, { originalFilename: containsRegex(query.search) }];

  const [total, materials] = await Promise.all([
    Material.countDocuments(filter),
    Material.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
  ]);
  const [owners, projects, spaces] = await Promise.all([
    userRefs(materials.map((m) => m.ownerId)),
    Project.find({ _id: { $in: materials.map((m) => m.projectId) } }, { name: 1 }).lean(),
    Space.find({ _id: { $in: materials.map((m) => m.spaceId) } }, { name: 1 }).lean(),
  ]);
  const projectName = new Map(projects.map((p) => [p._id.toString(), p.name]));
  const spaceName = new Map(spaces.map((s) => [s._id.toString(), s.name]));

  return {
    items: materials.map((m) => ({
      ...toMaterialDto(m),
      owner: owners.get(m.ownerId.toString()) ?? null,
      project: { id: m.projectId.toString(), name: projectName.get(m.projectId.toString()) ?? null },
      space: { id: m.spaceId.toString(), name: spaceName.get(m.spaceId.toString()) ?? null },
    })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function listActivity(query: ActivityQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  if (query.spaceId) filter.spaceId = toObjectId(query.spaceId);
  if (query.projectId) filter.projectId = toObjectId(query.projectId);
  if (query.type) filter.type = query.type;
  if (query.from || query.to) {
    filter.createdAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  }

  const [total, events] = await Promise.all([
    ActivityEvent.countDocuments(filter),
    ActivityEvent.find(filter).sort({ createdAt: -1 }).skip(skipFor(query.page, query.limit)).limit(query.limit).lean(),
  ]);
  return { items: await withUsers(events), page: query.page, limit: query.limit, total };
}

export function listActivityTypes() {
  return [...ACTIVITY_TYPES];
}

/** Lets an operator inspect a learner's PDF (e.g. to debug processing). Every access is audit-logged. */
export async function openMaterialFileAsAdmin(
  adminId: string,
  materialId: string,
  meta: { ip?: string; userAgent?: string },
) {
  const material = await Material.findById(toObjectId(materialId)).lean();
  if (!material) throw AppError.notFound('Material');
  const file = await storage.open(material.storage.fileId.toString());
  if (!file) throw AppError.notFound('File');
  await AuditLog.create({
    actorId: toObjectId(adminId),
    action: 'admin.material.viewed',
    targetType: 'material',
    targetId: material._id,
    ownerId: material.ownerId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { material, file };
}

export async function getSystemHealth() {
  const since24h = new Date(Date.now() - 86_400_000);
  const [dbLatencyMs, dbStats, storageUsage, workerStatus, queued, running, failed24h, oldestQueued, ai24h, chunkCount, conceptCount] = await Promise.all([
    pingDatabase(),
    getDb()
      .command({ dbStats: 1 })
      .catch(() => null),
    storage.usage().catch(() => null),
    getWorkerStatus().catch(() => ({ alive: 0, workers: [] })),
    Job.countDocuments({ status: 'queued', runAt: { $lte: new Date() } }).catch(() => null),
    Job.countDocuments({ status: 'running' }).catch(() => null),
    Job.countDocuments({ status: 'failed', finishedAt: { $gte: since24h } }).catch(() => null),
    Job.findOne({ status: 'queued', runAt: { $lte: new Date() } }, { runAt: 1 }).sort({ runAt: 1 }).lean().catch(() => null),
    AiCall.aggregate<{ calls: number; errors: number; costUsd: number; avgLatencyMs: number }>([
      { $match: { createdAt: { $gte: since24h } } },
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          costUsd: { $sum: '$costUsd' },
          avgLatencyMs: { $avg: '$latencyMs' },
        },
      },
    ]).catch(() => []),
    Chunk.estimatedDocumentCount().catch(() => null),
    Concept.estimatedDocumentCount().catch(() => null),
  ]);
  const gateway = ai().status();
  const openBreakers = gateway.breakers.filter((b) => b.open).length;
  const aiStats = ai24h[0];
  const oldestQueuedSec = oldestQueued ? Math.round((Date.now() - new Date(oldestQueued.runAt).getTime()) / 1000) : 0;
  const vector = vectorIndexState();
  const memory = process.memoryUsage();
  const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

  return {
    status: dbLatencyMs === null || workerStatus.alive === 0 || openBreakers > 0 ? 'degraded' : 'ok',
    checkedAt: new Date(),
    api: {
      status: 'up',
      version: config.APP_VERSION,
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      role: config.APP_ROLE,
      uptimeSec: Math.round(process.uptime()),
      memory: { rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal) },
    },
    database: {
      status: dbLatencyMs === null ? 'down' : 'up',
      latencyMs: dbLatencyMs,
      name: config.MONGODB_DB_NAME,
      collections: dbStats?.collections ?? null,
      objects: dbStats?.objects ?? null,
      dataSizeBytes: dbStats?.dataSize ?? null,
      storageSizeBytes: dbStats?.storageSize ?? null,
      indexSizeBytes: dbStats?.indexSize ?? null,
    },
    storage: {
      status: storageUsage ? 'up' : 'unknown',
      provider: 'gridfs',
      files: storageUsage?.files ?? null,
      totalBytes: storageUsage?.totalBytes ?? null,
    },
    ai: {
      status: config.AI_PROVIDER === 'gemini' && !config.GEMINI_API_KEY ? 'not_configured' : openBreakers ? 'degraded' : 'up',
      provider: gateway.provider,
      models: {
        primary: config.AI_MODEL_PRIMARY,
        fallbacks: config.aiFallbackModels,
        light: config.AI_MODEL_LIGHT,
        lightFallbacks: config.aiLightFallbackModels,
        embedding: config.AI_EMBEDDING_MODEL,
      },
      inFlight: gateway.inFlight,
      breakers: gateway.breakers,
      last24h: {
        calls: aiStats?.calls ?? 0,
        errors: aiStats?.errors ?? 0,
        errorRate: aiStats?.calls ? Math.round((aiStats.errors / aiStats.calls) * 1000) / 1000 : 0,
        costUsd: Math.round((aiStats?.costUsd ?? 0) * 1e6) / 1e6,
        avgLatencyMs: aiStats?.avgLatencyMs ? Math.round(aiStats.avgLatencyMs) : null,
      },
    },
    worker: {
      status: workerStatus.alive > 0 ? 'up' : 'down',
      alive: workerStatus.alive,
      workers: workerStatus.workers,
      queue: { queued, running, failed24h, oldestQueuedSec },
    },
    retrieval: {
      status: vector.status === 'ready' ? 'up' : vector.status === 'building' || vector.status === 'unknown' ? 'degraded' : 'fallback',
      vectorIndex: vector,
      mode: vector.status === 'ready' ? 'Atlas Vector Search + lexical (hybrid)' : 'In-process cosine + lexical (fallback)',
      chunks: chunkCount,
      concepts: conceptCount,
    },
  };
}
