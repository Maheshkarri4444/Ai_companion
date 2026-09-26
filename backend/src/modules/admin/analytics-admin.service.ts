import type { Types } from 'mongoose';
import { ActivityEvent, type ActivityType } from '../../models/activityEvent.model';
import { Concept } from '../../models/knowledge.model';
import { Mastery } from '../../models/mastery.model';
import { Message } from '../../models/message.model';
import { Project } from '../../models/project.model';
import { Attempt, QuizSession } from '../../models/quiz.model';
import { Recommendation } from '../../models/recommendation.model';
import { User } from '../../models/user.model';
import { dayKeys } from '../analytics/analytics.service';
import { bandOf, masteryOf } from '../mastery/estimator';
import { userRefs } from './admin.service';

/*
 * Platform analytics for operators (PRD §16 "Engagement", "Learning analytics"; docs/ARCHITECTURE.md §22).
 * Read-only aggregations across tenants — only reachable behind requireRole('admin').
 */

const DAY_MS = 86_400_000;
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;
const dayKeyExpr = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } };
const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type AdminRange = keyof typeof RANGES;
/** Anything a learner does on purpose — sign-ins and background recommendations don't count as engagement. */
const ENGAGED = { $nin: ['user.logged_in', 'recommendation.generated'] as ActivityType[] };

async function learnerIds(): Promise<Types.ObjectId[]> {
  return (await User.find({ role: 'user' }, { _id: 1 }).lean()).map((u) => u._id);
}

async function activeUsersSince(since: Date, learners: Types.ObjectId[]) {
  return (await ActivityEvent.distinct('ownerId', { ownerId: { $in: learners }, type: ENGAGED, createdAt: { $gte: since } })).length;
}

/** GET /admin/engagement?range= */
export async function getEngagement(range: AdminRange, now = new Date()) {
  const days = RANGES[range];
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const learners = await learnerIds();
  const inLearners = { $in: learners };

  const [dau, wau, mau, daily, signups, featureRows, topRows, cohortUsers] = await Promise.all([
    activeUsersSince(new Date(now.getTime() - DAY_MS), learners),
    activeUsersSince(new Date(now.getTime() - 7 * DAY_MS), learners),
    activeUsersSince(new Date(now.getTime() - 30 * DAY_MS), learners),
    ActivityEvent.aggregate<{ _id: string; events: number; users: number }>([
      { $match: { ownerId: inLearners, type: ENGAGED, createdAt: { $gte: since } } },
      { $group: { _id: dayKeyExpr, events: { $sum: 1 }, users: { $addToSet: '$ownerId' } } },
      { $project: { events: 1, users: { $size: '$users' } } },
    ]),
    User.aggregate<{ _id: string; n: number }>([
      { $match: { role: 'user', createdAt: { $gte: since } } },
      { $group: { _id: dayKeyExpr, n: { $sum: 1 } } },
    ]),
    ActivityEvent.aggregate<{ _id: string; users: number; events: number }>([
      { $match: { ownerId: inLearners, createdAt: { $gte: since }, type: { $in: ['material.uploaded', 'tutor.answered', 'quiz.completed', 'quiz.question_answered', 'recommendation.completed'] } } },
      { $group: { _id: '$type', users: { $addToSet: '$ownerId' }, events: { $sum: 1 } } },
      { $project: { events: 1, users: { $size: '$users' } } },
    ]),
    ActivityEvent.aggregate<{ _id: Types.ObjectId; events: number; last: Date }>([
      { $match: { ownerId: inLearners, type: ENGAGED, createdAt: { $gte: since } } },
      { $group: { _id: '$ownerId', events: { $sum: 1 }, last: { $max: '$createdAt' } } },
      { $sort: { events: -1 } },
      { $limit: 8 },
    ]),
    // Retention cohort: learners who joined 7–60 days ago — how many came back in the last 7 days?
    User.find({ role: 'user', createdAt: { $lte: new Date(now.getTime() - 7 * DAY_MS), $gte: new Date(now.getTime() - 60 * DAY_MS) } }, { _id: 1 }).lean(),
  ]);
  const retained = cohortUsers.length
    ? (await ActivityEvent.distinct('ownerId', { ownerId: { $in: cohortUsers.map((u) => u._id) }, type: ENGAGED, createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) } })).length
    : 0;
  const activeInRange = await activeUsersSince(since, learners);
  const byDay = new Map(daily.map((d) => [d._id, d]));
  const signupsByDay = new Map(signups.map((d) => [d._id, d.n]));
  const refs = await userRefs(topRows.map((r) => r._id));
  const feature = (type: string) => featureRows.find((f) => f._id === type);

  return {
    range: { key: range, days, from: since, to: now },
    kpis: {
      learners: learners.length,
      dau,
      wau,
      mau,
      stickiness: mau ? round(dau / mau) : null,
      activeInRange,
      newLearners: signups.reduce((n, s) => n + s.n, 0),
      retention7d: cohortUsers.length ? round(retained / cohortUsers.length) : null,
      retentionCohort: cohortUsers.length,
    },
    series: dayKeys(days, now).map((date) => ({
      date,
      activeUsers: byDay.get(date)?.users ?? 0,
      events: byDay.get(date)?.events ?? 0,
      signups: signupsByDay.get(date) ?? 0,
    })),
    adoption: [
      { feature: 'Uploaded material', type: 'material.uploaded' },
      { feature: 'Asked Zoya', type: 'tutor.answered' },
      { feature: 'Answered quiz questions', type: 'quiz.question_answered' },
      { feature: 'Completed a quiz', type: 'quiz.completed' },
      { feature: 'Followed a recommendation', type: 'recommendation.completed' },
    ].map((f) => ({ ...f, users: feature(f.type)?.users ?? 0, events: feature(f.type)?.events ?? 0, share: activeInRange ? round((feature(f.type)?.users ?? 0) / activeInRange) : null })),
    topLearners: topRows.map((r) => ({ user: refs.get(r._id.toString()) ?? { id: r._id.toString(), name: 'Deleted user', email: '' }, events: r.events, lastActiveAt: r.last })),
  };
}

/** GET /admin/learning?range= */
export async function getLearningAnalytics(range: AdminRange, now = new Date()) {
  const days = RANGES[range];
  const since = new Date(now.getTime() - (days - 1) * DAY_MS);
  since.setUTCHours(0, 0, 0, 0);
  const graded = { 'grading.status': 'graded', createdAt: { $gte: since } };

  const [started, completed, overall, byType, byDifficulty, hardest, masteries, recs, tutor, daily] = await Promise.all([
    QuizSession.countDocuments({ createdAt: { $gte: since } }),
    QuizSession.countDocuments({ status: 'completed', completedAt: { $gte: since } }),
    Attempt.aggregate<{ n: number; correct: number; score: number; learners: number }>([
      { $match: graded },
      { $group: { _id: null, n: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } }, score: { $sum: '$outcome' }, learners: { $addToSet: '$ownerId' } } },
      { $project: { n: 1, correct: 1, score: 1, learners: { $size: '$learners' } } },
    ]),
    Attempt.aggregate<{ _id: string; n: number; score: number }>([{ $match: graded }, { $group: { _id: '$type', n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
    Attempt.aggregate<{ _id: number; n: number; score: number }>([{ $match: graded }, { $group: { _id: '$difficulty', n: { $sum: 1 }, score: { $sum: '$outcome' } } }, { $sort: { _id: 1 } }]),
    Attempt.aggregate<{ _id: Types.ObjectId; n: number; score: number; learners: number }>([
      { $match: graded },
      { $unwind: '$conceptIds' },
      { $group: { _id: '$conceptIds', n: { $sum: 1 }, score: { $sum: '$outcome' }, learners: { $addToSet: '$ownerId' } } },
      { $match: { n: { $gte: 3 } } },
      { $project: { n: 1, score: 1, learners: { $size: '$learners' }, avg: { $divide: ['$score', '$n'] } } },
      { $sort: { avg: 1 } },
      { $limit: 8 },
    ]),
    Mastery.find({ evidenceCount: { $gt: 0 } }, { theta: 1, evidenceCount: 1, lastPracticedAt: 1 }).limit(20_000).lean(),
    Recommendation.aggregate<{ _id: string; n: number }>([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Message.aggregate<{ _id: string | null; n: number }>([
      { $match: { role: 'assistant', status: 'complete', createdAt: { $gte: since } } },
      { $group: { _id: '$grounding.status', n: { $sum: 1 } } },
    ]),
    Attempt.aggregate<{ _id: string; n: number; score: number }>([{ $match: graded }, { $group: { _id: dayKeyExpr, n: { $sum: 1 }, score: { $sum: '$outcome' } } }]),
  ]);

  const concepts = await Concept.find({ _id: { $in: hardest.map((h) => h._id) } }, { name: 1, projectId: 1 }).lean();
  const projects = await Project.find({ _id: { $in: concepts.map((c) => c.projectId) } }, { name: 1 }).lean();
  const conceptById = new Map(concepts.map((c) => [c._id.toString(), c]));
  const projectName = new Map(projects.map((p) => [p._id.toString(), p.name]));
  const bands = { needs_attention: 0, developing: 0, strong: 0 };
  for (const m of masteries) {
    const band = bandOf(masteryOf(m, now));
    if (band !== 'not_assessed') bands[band] += 1;
  }
  const recBy = new Map(recs.map((r) => [r._id, r.n]));
  const generated = recs.reduce((n, r) => n + r.n, 0);
  const acted = recBy.get('completed') ?? 0;
  const dismissed = recBy.get('dismissed') ?? 0;
  const tutorTotal = tutor.reduce((n, t) => n + t.n, 0);
  const o = overall[0];
  const byDay = new Map(daily.map((d) => [d._id, d]));

  return {
    range: { key: range, days, from: since, to: now },
    quizzes: { started, completed, completionRate: started ? round(completed / started) : null },
    answers: {
      answered: o?.n ?? 0,
      learners: o?.learners ?? 0,
      accuracy: o?.n ? round(o.correct / o.n) : null,
      avgScore: o?.n ? round(o.score / o.n) : null,
      byType: byType.map((t) => ({ type: t._id, answered: t.n, avgScore: round(t.score / t.n) })),
      byDifficulty: byDifficulty.map((d) => ({ difficulty: d._id, answered: d.n, avgScore: round(d.score / d.n) })),
      series: dayKeys(days, now).map((date) => ({ date, answered: byDay.get(date)?.n ?? 0, avgScore: byDay.get(date) ? round(byDay.get(date)!.score / byDay.get(date)!.n) : null })),
    },
    mastery: { assessedConcepts: masteries.length, bands },
    hardestConcepts: hardest.map((h) => {
      const concept = conceptById.get(h._id.toString());
      return {
        conceptId: h._id.toString(),
        name: concept?.name ?? 'Deleted concept',
        project: concept ? (projectName.get(concept.projectId.toString()) ?? null) : null,
        answered: h.n,
        avgScore: round(h.score / h.n),
        learners: h.learners,
      };
    }),
    recommendations: {
      generated,
      acted,
      dismissed,
      actRate: generated ? round(acted / generated) : null,
    },
    tutor: {
      answers: tutorTotal,
      grounding: tutor.map((t) => ({ status: t._id ?? 'unknown', count: t.n })),
      groundedRate: tutorTotal ? round((tutor.find((t) => t._id === 'grounded')?.n ?? 0) / tutorTotal) : null,
    },
  };
}
