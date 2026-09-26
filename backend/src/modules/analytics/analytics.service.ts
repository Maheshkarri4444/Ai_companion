import type { Types } from 'mongoose';
import { toObjectId } from '../../lib/validation';
import { ActivityEvent, type ActivityType } from '../../models/activityEvent.model';
import { AiCall } from '../../models/aiCall.model';
import { Concept } from '../../models/knowledge.model';
import { Mastery } from '../../models/mastery.model';
import { Material } from '../../models/material.model';
import { Message } from '../../models/message.model';
import { Project } from '../../models/project.model';
import { Attempt, QuizSession } from '../../models/quiz.model';
import { Space } from '../../models/space.model';
import { computeProjectGrowth } from '../growth/growth.service';
import { bandOf, masteryOf, masterySummary } from '../mastery/estimator';
import { getOwnedProject } from '../projects/projects.service';

/*
 * Learner analytics (PRD §12, docs/ARCHITECTURE.md §21): Project analytics (activity, assessment performance, mastery,
 * concept trends, AI activity) and global analytics across Spaces and Projects. Aggregation pipelines over indexed
 * collections; every query is scoped by the owner (and Project).
 */

const DAY_MS = 86_400_000;
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;
const dayKeyExpr = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } });

export const ANALYTICS_RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type AnalyticsRange = keyof typeof ANALYTICS_RANGES;

export function dayKeys(days: number, now = new Date()): string[] {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => new Date(today.getTime() - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Current and longest run of consecutive active days (UTC) from a set of day keys. */
export function streaks(activeDays: Set<string>, now = new Date()) {
  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const key of sorted) {
    const t = new Date(`${key}T00:00:00Z`).getTime();
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = t;
  }
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  // A streak is still alive if the learner was active today or yesterday.
  let cursor = activeDays.has(today.toISOString().slice(0, 10)) ? today.getTime() : today.getTime() - DAY_MS;
  let current = 0;
  while (activeDays.has(new Date(cursor).toISOString().slice(0, 10))) {
    current++;
    cursor -= DAY_MS;
  }
  return { current, longest };
}

const LEARNING_EVENT_FILTER = { $nin: ['user.logged_in', 'recommendation.generated'] as ActivityType[] };

/** Distinct UTC days with learning activity in the last year (for streaks). */
export async function activeDaySet(match: Record<string, unknown>, now: Date) {
  const rows = await ActivityEvent.aggregate<{ _id: string }>([
    { $match: { ...match, type: LEARNING_EVENT_FILTER, createdAt: { $gte: new Date(now.getTime() - 365 * DAY_MS) } } },
    { $group: { _id: dayKeyExpr('createdAt') } },
  ]);
  return new Set(rows.map((r) => r._id));
}

async function activityByDay(match: Record<string, unknown>, since: Date) {
  const rows = await ActivityEvent.aggregate<{ _id: { day: string; type: string }; n: number }>([
    { $match: { ...match, createdAt: { $gte: since }, type: LEARNING_EVENT_FILTER } },
    { $group: { _id: { day: dayKeyExpr('createdAt'), type: '$type' }, n: { $sum: 1 } } },
  ]);
  const byDay = new Map<string, { total: number; tutor: number; answers: number; materials: number; quizzes: number }>();
  const byType = new Map<string, number>();
  for (const r of rows) {
    const d = byDay.get(r._id.day) ?? { total: 0, tutor: 0, answers: 0, materials: 0, quizzes: 0 };
    d.total += r.n;
    if (r._id.type === 'tutor.answered') d.tutor += r.n;
    if (r._id.type === 'quiz.question_answered') d.answers += r.n;
    if (r._id.type === 'quiz.completed') d.quizzes += r.n;
    if (r._id.type.startsWith('material.')) d.materials += r.n;
    byDay.set(r._id.day, d);
    byType.set(r._id.type, (byType.get(r._id.type) ?? 0) + r.n);
  }
  return { byDay, byType };
}

async function assessmentStats(match: Record<string, unknown>, since: Date) {
  const graded = { ...match, 'grading.status': 'graded', createdAt: { $gte: since } };
  const [overall, byType, byDifficulty, byLevel, byDay] = await Promise.all([
    Attempt.aggregate<{ n: number; correct: number; score: number; timeMs: number }>([
      { $match: graded },
      { $group: { _id: null, n: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } }, score: { $sum: '$outcome' }, timeMs: { $sum: { $ifNull: ['$timeMs', 0] } } } },
    ]),
    Attempt.aggregate<{ _id: string; n: number; score: number }>([{ $match: graded }, { $group: { _id: '$type', n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
    Attempt.aggregate<{ _id: number; n: number; score: number }>([{ $match: graded }, { $group: { _id: '$difficulty', n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
    Attempt.aggregate<{ _id: string; n: number; score: number }>([{ $match: graded }, { $group: { _id: '$cognitiveLevel', n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
    Attempt.aggregate<{ _id: string; n: number; score: number }>([{ $match: graded }, { $group: { _id: dayKeyExpr('createdAt'), n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
  ]);
  const o = overall[0];
  const shape = (rows: Array<{ _id: string | number; n: number; score: number }>) =>
    rows.map((r) => ({ key: String(r._id), answered: r.n, avgScore: round(r.score / r.n) })).sort((a, b) => a.key.localeCompare(b.key));
  return {
    answered: o?.n ?? 0,
    correct: o?.correct ?? 0,
    accuracy: o?.n ? round(o.correct / o.n) : null,
    avgScore: o?.n ? round(o.score / o.n) : null,
    studyMinutes: o ? Math.round(o.timeMs / 60_000) : 0,
    byType: shape(byType),
    byDifficulty: shape(byDifficulty),
    byLevel: shape(byLevel),
    byDay: new Map(byDay.map((r) => [r._id, { answered: r.n, avgScore: round(r.score / r.n) }])),
  };
}

/** GET /projects/:projectId/analytics?range= */
export async function getProjectAnalytics(ownerId: string, projectId: string, range: AnalyticsRange, now = new Date()) {
  const project = await getOwnedProject(ownerId, projectId);
  const days = ANALYTICS_RANGES[range];
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const keys = dayKeys(days, now);

  const [activity, assessment, growth, quizzesCompleted, questions, grounding, conversations, ai, allActiveDays] = await Promise.all([
    activityByDay(scope, since),
    assessmentStats(scope, since),
    computeProjectGrowth(project.ownerId, project._id, days, now),
    QuizSession.countDocuments({ ...scope, status: 'completed', completedAt: { $gte: since } }),
    Message.countDocuments({ ...scope, role: 'user', createdAt: { $gte: since } }),
    Message.aggregate<{ _id: string | null; n: number }>([
      { $match: { ...scope, role: 'assistant', status: 'complete', createdAt: { $gte: since } } },
      { $group: { _id: '$grounding.status', n: { $sum: 1 } } },
    ]),
    Message.distinct('conversationId', { ...scope, createdAt: { $gte: since } }),
    AiCall.aggregate<{ calls: number; tokens: number; cost: number }>([
      { $match: { ownerId: project.ownerId, projectId: project._id, createdAt: { $gte: since } } },
      { $group: { _id: null, calls: { $sum: 1 }, tokens: { $sum: { $add: ['$usage.inputTokens', '$usage.outputTokens', '$usage.thinkingTokens'] } }, cost: { $sum: '$costUsd' } } },
    ]),
    activeDaySet(scope, now),
  ]);

  const answeredTutor = grounding.reduce((n, g) => n + g.n, 0);
  const groundedCount = grounding.find((g) => g._id === 'grounded')?.n ?? 0;
  const bands = { not_assessed: 0, needs_attention: 0, developing: 0, strong: 0 } as Record<ReturnType<typeof bandOf>, number>;
  for (const c of growth.concepts) bands[bandOf(c.mastery)] += 1;
  const movers = growth.concepts.filter((c) => c.delta !== null).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

  return {
    project: { id: project._id.toString(), name: project.name },
    range: { key: range, days, from: since, to: now },
    kpis: {
      activeDays: keys.filter((k) => activity.byDay.has(k)).length,
      streak: streaks(allActiveDays, now),
      tutorQuestions: questions,
      quizzesCompleted,
      answered: assessment.answered,
      accuracy: assessment.accuracy,
      avgScore: assessment.avgScore,
      studyMinutes: assessment.studyMinutes,
      overallMastery: growth.summary.overallMastery,
      overallChange: growth.summary.overallChange,
      coverage: growth.summary.coverage,
    },
    activity: {
      series: keys.map((date) => ({ date, ...(activity.byDay.get(date) ?? { total: 0, tutor: 0, answers: 0, materials: 0, quizzes: 0 }) })),
      byType: [...activity.byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    },
    assessment: {
      answered: assessment.answered,
      accuracy: assessment.accuracy,
      avgScore: assessment.avgScore,
      byType: assessment.byType,
      byDifficulty: assessment.byDifficulty,
      byLevel: assessment.byLevel,
      series: keys.map((date) => ({ date, answered: assessment.byDay.get(date)?.answered ?? 0, avgScore: assessment.byDay.get(date)?.avgScore ?? null })),
    },
    mastery: { summary: growth.summary, bands, progressSeries: growth.progressSeries },
    conceptTrends: {
      counts: growth.summary.counts,
      improving: movers.filter((c) => (c.delta ?? 0) > 0).slice(0, 5).map((c) => ({ conceptId: c.conceptId, name: c.name, mastery: c.mastery, delta: c.delta, status: c.status })),
      declining: movers.filter((c) => (c.delta ?? 0) < 0).reverse().slice(0, 5).map((c) => ({ conceptId: c.conceptId, name: c.name, mastery: c.mastery, delta: c.delta, status: c.status })),
    },
    ai: {
      tutorQuestions: questions,
      tutorAnswers: answeredTutor,
      conversations: conversations.length,
      groundedRate: answeredTutor ? round(groundedCount / answeredTutor) : null,
      grounding: grounding.map((g) => ({ status: g._id ?? 'unknown', count: g.n })),
      calls: ai[0]?.calls ?? 0,
      tokens: ai[0]?.tokens ?? 0,
      costUsd: round(ai[0]?.cost ?? 0, 6),
    },
  };
}

/** Mastery summary per Project without the snapshot history (cheap, used across many Projects). */
async function projectMasteryMap(ownerId: Types.ObjectId, projectIds: Types.ObjectId[], now: Date) {
  const [concepts, masteries] = await Promise.all([
    Concept.find({ ownerId, projectId: { $in: projectIds } }, { projectId: 1, importance: 1 }).lean(),
    Mastery.find({ ownerId, projectId: { $in: projectIds } }, { conceptId: 1, theta: 1, evidenceCount: 1, lastPracticedAt: 1 }).lean(),
  ]);
  const byConcept = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  const perProject = new Map<string, Array<{ mastery: number | null; importance: number }>>();
  for (const c of concepts) {
    const list = perProject.get(c.projectId.toString()) ?? [];
    list.push({ mastery: masteryOf(byConcept.get(c._id.toString()), now), importance: c.importance ?? 0.5 });
    perProject.set(c.projectId.toString(), list);
  }
  return new Map([...perProject.entries()].map(([id, items]) => [id, masterySummary(items)]));
}

/** Combines per-Project summaries: mastery weighted by assessed concepts, coverage over all concepts. */
export function combineSummaries(items: Array<ReturnType<typeof masterySummary>>) {
  const assessed = items.reduce((n, s) => n + s.assessedConcepts, 0);
  const total = items.reduce((n, s) => n + s.totalConcepts, 0);
  const weighted = items.reduce((n, s) => n + (s.overallMastery ?? 0) * s.assessedConcepts, 0);
  return {
    overallMastery: assessed ? round(weighted / assessed) : null,
    assessedConcepts: assessed,
    totalConcepts: total,
    coverage: total ? round(assessed / total) : 0,
    needsAttention: items.reduce((n, s) => n + s.needsAttention, 0),
    strong: items.reduce((n, s) => n + s.strong, 0),
  };
}

/** GET /analytics?range= — every Space and Project of the learner. */
export async function getGlobalAnalytics(ownerId: string, range: AnalyticsRange, now = new Date()) {
  const owner = toObjectId(ownerId);
  const days = ANALYTICS_RANGES[range];
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const keys = dayKeys(days, now);
  const [spaces, projects, activity, assessment, readyMaterials, questions, quizzesCompleted, activeDates, perProjectAnswers, perProjectQuestions] = await Promise.all([
    Space.find({ ownerId: owner }, { name: 1, color: 1, icon: 1 }).lean(),
    Project.find({ ownerId: owner }, { name: 1, spaceId: 1, lastActivityAt: 1 }).sort({ lastActivityAt: -1 }).lean(),
    activityByDay({ ownerId: owner }, since),
    assessmentStats({ ownerId: owner }, since),
    Material.countDocuments({ ownerId: owner, status: 'ready' }),
    Message.countDocuments({ ownerId: owner, role: 'user', createdAt: { $gte: since } }),
    QuizSession.countDocuments({ ownerId: owner, status: 'completed', completedAt: { $gte: since } }),
    activeDaySet({ ownerId: owner }, now),
    Attempt.aggregate<{ _id: Types.ObjectId; n: number; score: number }>([
      { $match: { ownerId: owner, 'grading.status': 'graded', createdAt: { $gte: since } } },
      { $group: { _id: '$projectId', n: { $sum: 1 }, score: { $sum: '$outcome' } } },
    ]),
    Message.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { ownerId: owner, role: 'user', createdAt: { $gte: since } } },
      { $group: { _id: '$projectId', n: { $sum: 1 } } },
    ]),
  ]);
  const summaries = await projectMasteryMap(owner, projects.map((p) => p._id), now);
  const answersBy = new Map(perProjectAnswers.map((r) => [r._id.toString(), r]));
  const questionsBy = new Map(perProjectQuestions.map((r) => [r._id.toString(), r.n]));
  const spaceById = new Map(spaces.map((s) => [s._id.toString(), s]));
  const empty = masterySummary([]);

  const perProject = projects.map((p) => {
    const summary = summaries.get(p._id.toString()) ?? empty;
    const answers = answersBy.get(p._id.toString());
    const space = spaceById.get(p.spaceId.toString());
    return {
      id: p._id.toString(),
      name: p.name,
      space: space ? { id: space._id.toString(), name: space.name, color: space.color, icon: space.icon } : null,
      overallMastery: summary.overallMastery,
      coverage: summary.coverage,
      assessedConcepts: summary.assessedConcepts,
      totalConcepts: summary.totalConcepts,
      needsAttention: summary.needsAttention,
      answered: answers?.n ?? 0,
      avgScore: answers?.n ? round(answers.score / answers.n) : null,
      tutorQuestions: questionsBy.get(p._id.toString()) ?? 0,
      lastActivityAt: p.lastActivityAt,
    };
  });
  const perSpace = spaces.map((s) => {
    const own = projects.filter((p) => p.spaceId.equals(s._id));
    const combined = combineSummaries(own.map((p) => summaries.get(p._id.toString()) ?? empty));
    return {
      id: s._id.toString(),
      name: s.name,
      color: s.color,
      icon: s.icon,
      projects: own.length,
      ...combined,
      answered: own.reduce((n, p) => n + (answersBy.get(p._id.toString())?.n ?? 0), 0),
    };
  });

  return {
    range: { key: range, days, from: since, to: now },
    kpis: {
      spaces: spaces.length,
      projects: projects.length,
      readyMaterials,
      tutorQuestions: questions,
      quizzesCompleted,
      answered: assessment.answered,
      accuracy: assessment.accuracy,
      avgScore: assessment.avgScore,
      studyMinutes: assessment.studyMinutes,
      activeDays: keys.filter((k) => activity.byDay.has(k)).length,
      streak: streaks(activeDates, now),
      ...combineSummaries([...summaries.values()]),
    },
    activity: {
      series: keys.map((date) => ({ date, ...(activity.byDay.get(date) ?? { total: 0, tutor: 0, answers: 0, materials: 0, quizzes: 0 }) })),
      byType: [...activity.byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    },
    assessment: {
      byType: assessment.byType,
      byDifficulty: assessment.byDifficulty,
      series: keys.map((date) => ({ date, answered: assessment.byDay.get(date)?.answered ?? 0, avgScore: assessment.byDay.get(date)?.avgScore ?? null })),
    },
    perSpace,
    perProject,
  };
}
