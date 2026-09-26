import { Types } from 'mongoose';
import { ai } from '../../ai';
import { EVALUATION_PROMPTS } from '../../ai/prompts/evaluation';
import { CONCEPTS_PROMPT, OCR_PROMPT } from '../../ai/prompts/knowledge';
import { QUIZ_PROMPTS } from '../../ai/prompts/quiz';
import { TUTOR_PROMPTS } from '../../ai/prompts/tutor';
import { AI_FEATURES } from '../../ai/types';
import { config } from '../../config/env';
import { AppError } from '../../lib/errors';
import { toObjectId, type Paginated } from '../../lib/validation';
import { AiCall, type IAiCall } from '../../models/aiCall.model';
import { AiEvaluation, EvalRun, type IAiEvaluation } from '../../models/aiEvaluation.model';
import { Job } from '../../models/job.model';
import { Message } from '../../models/message.model';
import { Project } from '../../models/project.model';
import { Attempt } from '../../models/quiz.model';
import { Recommendation } from '../../models/recommendation.model';
import { registeredContextProviders } from '../learning-context/providers';
import { registeredTutorTools } from '../tutor/tools';
import { userRefs } from './admin.service';
import type { AiCallsQuery, EvaluationsQuery, RangeQuery } from './admin.schemas';

/*
 * AI observability for operators (PRD §14): answers "why was it slow, which model, why was retrieval poor,
 * which workflow failed, what did it cost" from the ai_calls / messages / ai_evaluations / jobs records.
 */

const RANGE_MS = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
type Range = keyof typeof RANGE_MS;

const round = (n: number | null | undefined, digits = 0) => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function bucketsFor(range: Range) {
  const hourly = range === '24h';
  const step = hourly ? 3_600_000 : 86_400_000;
  const count = hourly ? 24 : range === '7d' ? 7 : 30;
  const now = new Date();
  if (hourly) now.setUTCMinutes(0, 0, 0);
  else now.setUTCHours(0, 0, 0, 0);
  const keys = Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getTime() - (count - 1 - i) * step);
    return hourly ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
  });
  const format = hourly ? '%Y-%m-%dT%H' : '%Y-%m-%d';
  return { keys, groupKey: { $dateToString: { format, date: '$createdAt', timezone: 'UTC' } } };
}

const groupStats = {
  calls: { $sum: 1 },
  errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
  fallbacks: { $sum: { $cond: ['$fallbackUsed', 1, 0] } },
  retries: { $sum: '$retries' },
  inputTokens: { $sum: '$usage.inputTokens' },
  outputTokens: { $sum: '$usage.outputTokens' },
  thinkingTokens: { $sum: '$usage.thinkingTokens' },
  costUsd: { $sum: '$costUsd' },
  avgLatencyMs: { $avg: '$latencyMs' },
  avgTtftMs: { $avg: '$ttftMs' },
};

type GroupRow = { _id: string | null; calls: number; errors: number; fallbacks: number; retries: number; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number; avgLatencyMs: number | null; avgTtftMs: number | null };

function shapeGroup(row: GroupRow, latencies?: number[]) {
  const sorted = latencies ? [...latencies].sort((a, b) => a - b) : null;
  return {
    key: row._id ?? 'unknown',
    calls: row.calls,
    errors: row.errors,
    errorRate: row.calls ? round(row.errors / row.calls, 4) : 0,
    fallbackRate: row.calls ? round(row.fallbacks / row.calls, 4) : 0,
    retries: row.retries,
    tokens: { input: row.inputTokens, output: row.outputTokens, thinking: row.thinkingTokens, total: row.inputTokens + row.outputTokens + row.thinkingTokens },
    costUsd: round(row.costUsd, 6) ?? 0,
    avgLatencyMs: round(row.avgLatencyMs),
    avgTtftMs: round(row.avgTtftMs),
    ...(sorted ? { p50LatencyMs: percentile(sorted, 50), p95LatencyMs: percentile(sorted, 95) } : {}),
  };
}

export async function getAiOverview(query: RangeQuery) {
  const range = query.range as Range;
  const since = new Date(Date.now() - RANGE_MS[range]);
  const match = { createdAt: { $gte: since } };
  const { keys, groupKey } = bucketsFor(range);

  const [totals, byFeature, byModel, series, latencyRows, recentErrors, topUsers] = await Promise.all([
    AiCall.aggregate<GroupRow>([{ $match: match }, { $group: { _id: null, ...groupStats } }]),
    AiCall.aggregate<GroupRow>([{ $match: match }, { $group: { _id: '$feature', ...groupStats } }, { $sort: { calls: -1 } }]),
    AiCall.aggregate<GroupRow>([{ $match: match }, { $group: { _id: '$model', ...groupStats } }, { $sort: { calls: -1 } }]),
    AiCall.aggregate<{ _id: string; calls: number; errors: number; costUsd: number; tokens: number }>([
      { $match: match },
      {
        $group: {
          _id: groupKey,
          calls: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] } },
          costUsd: { $sum: '$costUsd' },
          tokens: { $sum: { $add: ['$usage.inputTokens', '$usage.outputTokens', '$usage.thinkingTokens'] } },
        },
      },
    ]),
    // Percentiles computed in-process over a bounded, recent sample (portable across MongoDB versions).
    AiCall.find({ ...match, status: 'success' }, { latencyMs: 1, feature: 1, model: 1 }).sort({ createdAt: -1 }).limit(5000).lean(),
    AiCall.find({ ...match, status: 'error' }).sort({ createdAt: -1 }).limit(8).lean(),
    AiCall.aggregate<{ _id: Types.ObjectId; calls: number; costUsd: number; tokens: number }>([
      { $match: { ...match, ownerId: { $ne: null } } },
      {
        $group: {
          _id: '$ownerId',
          calls: { $sum: 1 },
          costUsd: { $sum: '$costUsd' },
          tokens: { $sum: { $add: ['$usage.inputTokens', '$usage.outputTokens', '$usage.thinkingTokens'] } },
        },
      },
      { $sort: { costUsd: -1, calls: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const latencyBy = (key: 'feature' | 'model', value: string | null) =>
    latencyRows.filter((r) => (r[key] ?? 'unknown') === (value ?? 'unknown')).map((r) => r.latencyMs);
  const bySeries = new Map(series.map((s) => [s._id, s]));
  const users = await userRefs(topUsers.map((u) => u._id));
  const empty: GroupRow = { _id: null, calls: 0, errors: 0, fallbacks: 0, retries: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, avgLatencyMs: null, avgTtftMs: null };

  return {
    range,
    since,
    totals: shapeGroup(totals[0] ?? empty, latencyRows.map((r) => r.latencyMs)),
    byFeature: byFeature.map((row) => shapeGroup(row, latencyBy('feature', row._id))),
    byModel: byModel.map((row) => shapeGroup(row, latencyBy('model', row._id))),
    series: keys.map((key) => ({
      bucket: key,
      calls: bySeries.get(key)?.calls ?? 0,
      errors: bySeries.get(key)?.errors ?? 0,
      costUsd: round(bySeries.get(key)?.costUsd ?? 0, 6),
      tokens: bySeries.get(key)?.tokens ?? 0,
    })),
    topUsers: topUsers.map((u) => ({
      user: users.get(u._id.toString()) ?? { id: u._id.toString(), name: 'Deleted user', email: '' },
      calls: u.calls,
      costUsd: round(u.costUsd, 6),
      tokens: u.tokens,
    })),
    recentErrors: recentErrors.map(toCallSummary),
    gateway: ai().status(),
  };
}

function toCallSummary(call: IAiCall) {
  return {
    id: call._id.toString(),
    feature: call.feature,
    operation: call.operation,
    model: call.model,
    status: call.status,
    errorKind: call.errorKind,
    errorMessage: call.errorMessage,
    latencyMs: call.latencyMs,
    ttftMs: call.ttftMs,
    tokens: call.usage.inputTokens + call.usage.outputTokens + call.usage.thinkingTokens,
    costUsd: call.costUsd,
    fallbackUsed: call.fallbackUsed,
    retries: call.retries,
    promptVersion: call.promptVersion,
    inputPreview: call.inputPreview,
    ownerId: call.ownerId?.toString() ?? null,
    projectId: call.projectId?.toString() ?? null,
    messageId: call.messageId?.toString() ?? null,
    jobId: call.jobId?.toString() ?? null,
    traceId: call.traceId,
    createdAt: call.createdAt,
  };
}

export async function listAiCalls(query: AiCallsQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.feature) filter.feature = query.feature;
  if (query.status) filter.status = query.status;
  if (query.model) filter.model = query.model;
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  if (query.projectId) filter.projectId = toObjectId(query.projectId);
  if (query.traceId) filter.traceId = query.traceId;
  const [total, calls] = await Promise.all([
    AiCall.countDocuments(filter),
    AiCall.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);
  const users = await userRefs(calls.flatMap((c) => (c.ownerId ? [c.ownerId] : [])));
  return {
    items: calls.map((c) => ({ ...toCallSummary(c), user: c.ownerId ? (users.get(c.ownerId.toString()) ?? null) : null })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

/**
 * One call with everything needed to explain it: attempts (retries/fallbacks), usage, cost, the related
 * calls of the same request (waterfall), and — for Tutor answers — the retrieval trace and grounding.
 */
export async function getAiCall(callId: string) {
  const call = await AiCall.findById(toObjectId(callId)).lean();
  if (!call) throw AppError.notFound('AI call');
  const relatedFilter = call.messageId ? { messageId: call.messageId } : call.jobId ? { jobId: call.jobId } : call.traceId ? { traceId: call.traceId } : null;
  const [related, message, job, project, users] = await Promise.all([
    relatedFilter ? AiCall.find(relatedFilter).sort({ createdAt: 1 }).limit(50).lean() : Promise.resolve([]),
    call.messageId ? Message.findById(call.messageId).lean() : Promise.resolve(null),
    call.jobId ? Job.findById(call.jobId, { type: 1, status: 1, attempts: 1, lastError: 1 }).lean() : Promise.resolve(null),
    call.projectId ? Project.findById(call.projectId, { name: 1 }).lean() : Promise.resolve(null),
    userRefs(call.ownerId ? [call.ownerId] : []),
  ]);
  const question = message?.replyTo ? await Message.findById(message.replyTo, { content: 1 }).lean() : null;
  return {
    call: {
      ...toCallSummary(call),
      provider: call.provider,
      attempts: call.attempts,
      usage: call.usage,
      outputPreview: call.outputPreview,
      metadata: call.metadata,
    },
    user: call.ownerId ? (users.get(call.ownerId.toString()) ?? null) : null,
    project: project ? { id: project._id.toString(), name: project.name } : null,
    related: related.map(toCallSummary),
    job: job ? { id: job._id.toString(), type: job.type, status: job.status, attempts: job.attempts, lastError: job.lastError } : null,
    message: message
      ? {
          id: message._id.toString(),
          question: question?.content ?? null,
          content: message.content,
          status: message.status,
          intent: message.intent,
          grounding: message.grounding,
          metrics: message.metrics,
          toolCalls: message.toolCalls,
          sources: message.sources.map((s) => ({
            ref: s.ref,
            materialTitle: s.materialTitle,
            pageStart: s.pageStart,
            pageEnd: s.pageEnd,
            score: s.score,
            origin: s.origin,
            cited: s.cited,
            flagged: s.flagged,
            snippet: s.snippet,
          })),
          trace: message.trace,
          promptVersion: message.promptVersion,
          feedback: message.feedback,
        }
      : null,
  };
}

/* ─────────────────────────────── Evaluation ─────────────────────────────── */

export async function getEvaluationOverview(query: RangeQuery) {
  const range = query.range as Range;
  const since = new Date(Date.now() - RANGE_MS[range]);
  const match = { createdAt: { $gte: since } };
  const { keys, groupKey } = bucketsFor(range);

  // The headline evaluator cards describe Zoya's answers; quiz items have their own section (`assessment`), while the
  // verdict series and the failure list cover every evaluated subject.
  const tutor = { ...match, subjectType: 'tutor_message' };
  const [byEvaluator, judgeAverages, byPromptVersion, ruleFlags, grounding, series, recentFailures, runs, assessment, recommendations] = await Promise.all([
    AiEvaluation.aggregate<{ _id: { evaluator: string; verdict: string }; n: number }>([
      { $match: tutor },
      { $group: { _id: { evaluator: '$evaluator', verdict: '$verdict' }, n: { $sum: 1 } } },
    ]),
    AiEvaluation.aggregate<Record<string, number | null>>([
      { $match: { ...tutor, evaluator: 'llm_judge' } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          groundedness: { $avg: '$scores.groundedness' },
          citationAccuracy: { $avg: '$scores.citationAccuracy' },
          relevance: { $avg: '$scores.relevance' },
          pedagogy: { $avg: '$scores.pedagogy' },
          unsupportedHandling: { $avg: '$scores.unsupportedHandling' },
        },
      },
    ]),
    // Regression tracking: judge scores per prompt version.
    AiEvaluation.aggregate<{ _id: string | null; n: number; groundedness: number; citationAccuracy: number; pass: number }>([
      { $match: { ...tutor, evaluator: 'llm_judge' } },
      {
        $group: {
          _id: '$promptVersion',
          n: { $sum: 1 },
          groundedness: { $avg: '$scores.groundedness' },
          citationAccuracy: { $avg: '$scores.citationAccuracy' },
          pass: { $sum: { $cond: [{ $eq: ['$verdict', 'pass'] }, 1, 0] } },
        },
      },
      { $sort: { _id: -1 } },
    ]),
    AiEvaluation.aggregate<{ _id: string; n: number }>([
      { $match: { ...tutor, evaluator: 'rules' } },
      { $unwind: '$flags' },
      { $group: { _id: '$flags', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
    Message.aggregate<{ _id: string | null; n: number }>([
      { $match: { ...match, role: 'assistant', status: { $in: ['complete', 'stopped'] } } },
      { $group: { _id: '$grounding.status', n: { $sum: 1 } } },
    ]),
    AiEvaluation.aggregate<{ _id: string; pass: number; warn: number; fail: number }>([
      { $match: match },
      {
        $group: {
          _id: groupKey,
          pass: { $sum: { $cond: [{ $eq: ['$verdict', 'pass'] }, 1, 0] } },
          warn: { $sum: { $cond: [{ $eq: ['$verdict', 'warn'] }, 1, 0] } },
          fail: { $sum: { $cond: [{ $eq: ['$verdict', 'fail'] }, 1, 0] } },
        },
      },
    ]),
    AiEvaluation.find({ ...match, verdict: 'fail' }).sort({ createdAt: -1 }).limit(8).lean(),
    EvalRun.find({}, { cases: 0 }).sort({ createdAt: -1 }).limit(10).lean(),
    assessmentQuality(match),
    recommendationQuality(match),
  ]);

  const evaluators = ['rules', 'llm_judge', 'learner_feedback', 'offline_suite'].map((evaluator) => {
    const rows = byEvaluator.filter((r) => r._id.evaluator === evaluator);
    const count = (v: string) => rows.find((r) => r._id.verdict === v)?.n ?? 0;
    const total = rows.reduce((n, r) => n + r.n, 0);
    return { evaluator, total, pass: count('pass'), warn: count('warn'), fail: count('fail'), passRate: total ? round(count('pass') / total, 4) : null };
  });
  const avg = judgeAverages[0];
  const bySeries = new Map(series.map((s) => [s._id, s]));

  return {
    range,
    evaluators,
    judge: avg
      ? {
          samples: avg.n,
          groundedness: round(avg.groundedness, 3),
          citationAccuracy: round(avg.citationAccuracy, 3),
          relevance: round(avg.relevance, 3),
          pedagogy: round(avg.pedagogy, 3),
          unsupportedHandling: round(avg.unsupportedHandling, 3),
        }
      : null,
    byPromptVersion: byPromptVersion.map((r) => ({
      promptVersion: r._id ?? 'unknown',
      samples: r.n,
      groundedness: round(r.groundedness, 3),
      citationAccuracy: round(r.citationAccuracy, 3),
      passRate: round(r.pass / r.n, 4),
    })),
    topRuleFailures: ruleFlags.map((r) => ({ rule: r._id, count: r.n })),
    groundingDistribution: grounding.map((g) => ({ status: g._id ?? 'unknown', count: g.n })),
    series: keys.map((key) => ({ bucket: key, pass: bySeries.get(key)?.pass ?? 0, warn: bySeries.get(key)?.warn ?? 0, fail: bySeries.get(key)?.fail ?? 0 })),
    assessment,
    recommendations,
    recentFailures: recentFailures.map(toEvaluationDto),
    offlineRuns: runs.map((r) => ({
      id: r._id.toString(),
      suite: r.suite,
      label: r.label,
      provider: r.provider,
      models: r.models,
      promptVersions: r.promptVersions,
      summary: r.summary,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    })),
  };
}

const topFlags = (match: Record<string, unknown>) =>
  AiEvaluation.aggregate<{ _id: string; n: number }>([{ $match: match }, { $unwind: '$flags' }, { $group: { _id: '$flags', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 6 }]);

/**
 * Assessment quality (PRD §14 "question quality, grading quality, structured output reliability"): rule verdicts on
 * every generated question and every AI grading, judge scores on sampled questions, learner reports, grading backlog.
 */
async function assessmentQuality(match: Record<string, unknown>) {
  const questions = { ...match, subjectType: 'quiz_question' };
  const gradings = { ...match, subjectType: 'quiz_grading' };
  const [generation, generationFlags, grading, gradingFlags, judge, reports, pending, failed] = await Promise.all([
    AiEvaluation.aggregate<{ n: number; valid: number; firstPass: number; clean: number }>([
      { $match: { ...questions, evaluator: 'rules' } },
      { $group: { _id: null, n: { $sum: 1 }, valid: { $sum: '$scores.valid' }, firstPass: { $sum: '$scores.firstPass' }, clean: { $sum: '$scores.clean' } } },
    ]),
    topFlags({ ...questions, evaluator: 'rules' }),
    AiEvaluation.aggregate<{ n: number; pass: number; consistent: number; grounded: number }>([
      { $match: { ...gradings, evaluator: 'rules' } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$verdict', 'pass'] }, 1, 0] } },
          consistent: { $avg: '$scores.consistent' },
          grounded: { $avg: '$scores.grounded' },
        },
      },
    ]),
    topFlags({ ...gradings, evaluator: 'rules' }),
    AiEvaluation.aggregate<Record<string, number>>([
      { $match: { ...questions, evaluator: 'llm_judge' } },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$verdict', 'pass'] }, 1, 0] } },
          answerable: { $avg: '$scores.answerable' },
          keyCorrect: { $avg: '$scores.keyCorrect' },
          distractors: { $avg: '$scores.distractors' },
          clarity: { $avg: '$scores.clarity' },
          difficultyMatch: { $avg: '$scores.difficultyMatch' },
          levelMatch: { $avg: '$scores.levelMatch' },
        },
      },
    ]),
    AiEvaluation.countDocuments({ ...match, evaluator: 'learner_feedback', subjectType: { $in: ['quiz_question', 'quiz_grading'] } }),
    Attempt.countDocuments({ 'grading.status': 'pending' }),
    Attempt.countDocuments({ 'grading.status': 'failed' }),
  ]);
  const g = generation[0];
  const r = grading[0];
  const j = judge[0];
  return {
    generation: g
      ? { items: g.n, validRate: round(g.valid / g.n, 4), firstPassRate: round(g.firstPass / g.n, 4), cleanRate: round(g.clean / g.n, 4), topFlags: generationFlags.map((f) => ({ flag: f._id, count: f.n })) }
      : null,
    grading: r
      ? { graded: r.n, passRate: round(r.pass / r.n, 4), consistency: round(r.consistent, 3), grounded: round(r.grounded, 3), topFlags: gradingFlags.map((f) => ({ flag: f._id, count: f.n })) }
      : null,
    judge: j
      ? {
          samples: j.n,
          passRate: round(j.pass / j.n, 4),
          answerable: round(j.answerable, 3),
          keyCorrect: round(j.keyCorrect, 3),
          distractors: round(j.distractors, 3),
          clarity: round(j.clarity, 3),
          difficultyMatch: round(j.difficultyMatch, 3),
          levelMatch: round(j.levelMatch, 3),
        }
      : null,
    learnerReports: reports,
    gradingBacklog: { pending, failed },
  };
}

/**
 * Recommendation quality (PRD §14 "relevance, actionability, alignment with the learner state"): rule checks on every
 * recommendation as the learner reads it, how many the model phrased (vs the template fallback), and how learners responded.
 */
async function recommendationQuality(match: Record<string, unknown>) {
  const rules = { ...match, subjectType: 'recommendation', evaluator: 'rules' };
  const [checks, flags, byStatus, bySource] = await Promise.all([
    AiEvaluation.aggregate<{ n: number; pass: number; aligned: number; actionable: number }>([
      { $match: rules },
      {
        $group: {
          _id: null,
          n: { $sum: 1 },
          pass: { $sum: { $cond: [{ $eq: ['$verdict', 'pass'] }, 1, 0] } },
          aligned: { $avg: '$scores.aligned' },
          actionable: { $avg: '$scores.actionable' },
        },
      },
    ]),
    topFlags(rules),
    Recommendation.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Recommendation.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
  ]);
  const c = checks[0];
  const generated = byStatus.reduce((n, r) => n + r.n, 0);
  const status = (s: string) => byStatus.find((r) => r._id === s)?.n ?? 0;
  return {
    checked: c?.n ?? 0,
    passRate: c?.n ? round(c.pass / c.n, 4) : null,
    alignedRate: c?.n ? round(c.aligned, 4) : null,
    actionableRate: c?.n ? round(c.actionable, 4) : null,
    topFlags: flags.map((f) => ({ flag: f._id, count: f.n })),
    generated,
    aiPhrasedRate: generated ? round((bySource.find((r) => r._id === 'ai')?.n ?? 0) / generated, 4) : null,
    followed: status('completed'),
    dismissed: status('dismissed'),
    followRate: generated ? round(status('completed') / generated, 4) : null,
  };
}

function toEvaluationDto(e: IAiEvaluation) {
  return {
    id: e._id.toString(),
    subjectType: e.subjectType,
    subjectId: e.subjectId?.toString() ?? null,
    evaluator: e.evaluator,
    feature: e.feature,
    verdict: e.verdict,
    scores: e.scores,
    flags: e.flags,
    rationale: e.rationale,
    inputPreview: e.inputPreview,
    outputPreview: e.outputPreview,
    aiCallId: e.aiCallId?.toString() ?? null,
    promptVersion: e.promptVersion,
    model: e.model,
    ownerId: e.ownerId?.toString() ?? null,
    projectId: e.projectId?.toString() ?? null,
    createdAt: e.createdAt,
  };
}

export async function listEvaluations(query: EvaluationsQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.evaluator) filter.evaluator = query.evaluator;
  if (query.verdict) filter.verdict = query.verdict;
  if (query.subjectType) filter.subjectType = query.subjectType;
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  const [total, rows] = await Promise.all([
    AiEvaluation.countDocuments(filter),
    AiEvaluation.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);
  const users = await userRefs(rows.flatMap((r) => (r.ownerId ? [r.ownerId] : [])));
  return {
    items: rows.map((r) => ({ ...toEvaluationDto(r), user: r.ownerId ? (users.get(r.ownerId.toString()) ?? null) : null })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getEvalRun(runId: string) {
  const run = await EvalRun.findById(toObjectId(runId)).lean();
  if (!run) throw AppError.notFound('Evaluation run');
  return { ...run, id: run._id.toString(), _id: undefined };
}

/** The AI configuration in force: models, thresholds, prompt versions and registered capabilities. */
export function getAiConfiguration() {
  return {
    provider: config.AI_PROVIDER,
    models: {
      primary: [config.AI_MODEL_PRIMARY, ...config.aiFallbackModels],
      light: [config.AI_MODEL_LIGHT, ...config.aiLightFallbackModels],
      embedding: { model: config.AI_EMBEDDING_MODEL, dimensions: config.AI_EMBEDDING_DIM },
    },
    tutor: { reasoning: config.AI_TUTOR_REASONING, judgeSampleRate: config.TUTOR_JUDGE_SAMPLE_RATE },
    quiz: { judgeSampleRate: config.QUIZ_JUDGE_SAMPLE_RATE },
    retrieval: { strongScore: config.RETRIEVAL_STRONG_SCORE, minScore: config.RETRIEVAL_MIN_SCORE, vectorSearch: config.VECTOR_SEARCH_ENABLED },
    promptVersions: { ...TUTOR_PROMPTS, ...EVALUATION_PROMPTS, ...QUIZ_PROMPTS, concepts: CONCEPTS_PROMPT.version, ocr: OCR_PROMPT.version },
    features: [...AI_FEATURES],
    tools: registeredTutorTools(),
    contextProviders: registeredContextProviders(),
  };
}

/** Per-learner AI usage for the admin user view. */
export async function aiUsageForUser(ownerId: Types.ObjectId) {
  const [totals, byFeature, tutorStats, feedback] = await Promise.all([
    AiCall.aggregate<GroupRow>([{ $match: { ownerId } }, { $group: { _id: null, ...groupStats } }]),
    AiCall.aggregate<{ _id: string; calls: number; costUsd: number }>([
      { $match: { ownerId } },
      { $group: { _id: '$feature', calls: { $sum: 1 }, costUsd: { $sum: '$costUsd' } } },
      { $sort: { calls: -1 } },
    ]),
    Message.aggregate<{ _id: string | null; n: number }>([
      { $match: { ownerId, role: 'assistant' } },
      { $group: { _id: '$grounding.status', n: { $sum: 1 } } },
    ]),
    Message.aggregate<{ _id: string; n: number }>([
      { $match: { ownerId, role: 'assistant', feedback: { $ne: null } } },
      { $group: { _id: '$feedback.rating', n: { $sum: 1 } } },
    ]),
  ]);
  const t = totals[0];
  return {
    calls: t?.calls ?? 0,
    errors: t?.errors ?? 0,
    tokens: t ? t.inputTokens + t.outputTokens + t.thinkingTokens : 0,
    costUsd: round(t?.costUsd ?? 0, 6),
    avgLatencyMs: round(t?.avgLatencyMs ?? null),
    byFeature: byFeature.map((f) => ({ feature: f._id, calls: f.calls, costUsd: round(f.costUsd, 6) })),
    tutorAnswers: tutorStats.reduce((n, r) => n + r.n, 0),
    grounding: Object.fromEntries(tutorStats.map((r) => [r._id ?? 'unknown', r.n])),
    feedback: { up: feedback.find((f) => f._id === 'up')?.n ?? 0, down: feedback.find((f) => f._id === 'down')?.n ?? 0 },
  };
}
