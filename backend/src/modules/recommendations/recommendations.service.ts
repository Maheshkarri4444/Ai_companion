import { Types } from 'mongoose';
import { z } from 'zod';
import { ai, AIError } from '../../ai';
import { RECOMMEND_PROMPT } from '../../ai/prompts/recommendations';
import { enqueueJob } from '../../jobs/queue';
import { registerJobHandler } from '../../jobs/registry';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { escapePromptData, sha256, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { Concept } from '../../models/knowledge.model';
import { LearningContext } from '../../models/learningContext.model';
import { Material } from '../../models/material.model';
import { Message } from '../../models/message.model';
import { Project, type IProject } from '../../models/project.model';
import { QuizSession } from '../../models/quiz.model';
import { Recommendation, RECOMMENDATION_ACTIONS, type IRecommendation } from '../../models/recommendation.model';
import { recordEvent } from '../activity/activity.service';
import { recordEvaluation } from '../evaluation/evaluation.service';
import { computeProjectGrowth } from '../growth/growth.service';
import { registerContextProvider } from '../learning-context/providers';
import { getOwnedProject } from '../projects/projects.service';
import { buildCandidates, rankCandidates, type Candidate, type LearnerState } from './candidates';

/*
 * Recommendations (PRD §10, docs/ARCHITECTURE.md §19): rules pick the next actions from evidence, the light model
 * phrases them from the same facts (validated; templates on failure), and a batch is only regenerated when the
 * learner's state changes. Lifecycle: active → completed (acted on) | dismissed | expired (superseded).
 */

const HOUR_MS = 3_600_000;
const DISMISS_COOLDOWN_MS = 72 * HOUR_MS;
const IGNORED_WINDOW_MS = 24 * HOUR_MS;

type ProjectRef = Pick<IProject, '_id' | 'ownerId' | 'spaceId' | 'name' | 'learningGoal'>;

async function learnerState(project: ProjectRef, now: Date): Promise<LearnerState> {
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const [growth, conceptDocs, statusRows, active, completedCount, patterns, tutorQuestions] = await Promise.all([
    computeProjectGrowth(project.ownerId, project._id, 30, now),
    Concept.find(scope, { chunkCount: 1, sources: 1 }).lean(),
    Material.aggregate<{ _id: string; n: number }>([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    QuizSession.findOne({ ...scope, status: 'active' }, { answeredCount: 1, targetCount: 1 }).lean(),
    QuizSession.countDocuments({ ...scope, status: 'completed' }),
    LearningContext.find({ ...scope, kind: 'mistake_pattern', status: 'active' }, { content: 1, conceptIds: 1 }).sort({ salience: -1, lastObservedAt: -1 }).limit(3).lean(),
    Message.countDocuments({ ...scope, role: 'user' }),
  ]);
  const hasEvidence = new Map(conceptDocs.map((c) => [c._id.toString(), (c.chunkCount ?? 0) > 0 || c.sources.some((s) => s.pages.length > 0)]));
  const by = new Map(statusRows.map((r) => [r._id, r.n]));
  return {
    projectName: project.name,
    goal: project.learningGoal,
    materials: { ready: by.get('ready') ?? 0, pending: (by.get('queued') ?? 0) + (by.get('processing') ?? 0) },
    quiz: {
      activeSessionId: active?._id.toString() ?? null,
      activeAnswered: active?.answeredCount ?? 0,
      activeTarget: active?.targetCount ?? 0,
      completedCount,
      answered: growth.summary.answersInWindow,
    },
    tutor: { questions: tutorQuestions },
    concepts: growth.concepts.map((c) => ({ ...c, hasEvidence: hasEvidence.get(c.conceptId) ?? false })),
    mistakePatterns: patterns.map((p) => ({ content: p.content, conceptIds: p.conceptIds.map((id) => id.toString()) })),
    now,
  };
}

async function noveltyFor(project: ProjectRef, now: Date) {
  const recent = await Recommendation.find(
    { ownerId: project.ownerId, projectId: project._id, updatedAt: { $gte: new Date(now.getTime() - DISMISS_COOLDOWN_MS) } },
    { key: 1, status: 1, updatedAt: 1, createdAt: 1 },
  ).lean();
  const dismissed = new Set(recent.filter((r) => r.status === 'dismissed').map((r) => r.key));
  const ignored = new Set(
    recent.filter((r) => r.status === 'expired' && now.getTime() - new Date(r.createdAt).getTime() < IGNORED_WINDOW_MS).map((r) => r.key),
  );
  return { dismissed, ignored };
}

function stateHashOf(state: LearnerState, picked: Candidate[]) {
  return sha256(
    JSON.stringify({
      picked: picked.map((c) => [c.key, Math.round(c.priority * 100)]),
      ready: state.materials.ready,
      active: state.quiz.activeSessionId,
      mastery: state.concepts.map((c) => [c.conceptId, c.mastery === null ? null : Math.round(c.mastery * 20), c.status]),
    }),
  ).slice(0, 24);
}

/** Rule checks on every generated recommendation (PRD §14 "relevance, actionability, alignment with the learner state"). */
async function evaluateRecommendation(rec: IRecommendation, state: LearnerState, rank: number) {
  const conceptIds = new Set(state.concepts.map((c) => c.conceptId));
  const attention = state.concepts.filter((c) => c.status === 'attention').map((c) => c.conceptId);
  const text = `${rec.title} ${rec.rationale}`;
  const factsText = JSON.stringify(rec.evidence);
  const numbers = (text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !factsText.includes(n));
  const checks = [
    { name: 'action_allowed', passed: RECOMMENDATION_ACTIONS.includes(rec.action.type), severity: 'fail' as const },
    { name: 'ids_in_project', passed: rec.conceptIds.every((id) => conceptIds.has(id.toString())), severity: 'fail' as const },
    {
      name: 'aligned_with_attention',
      // The top suggestion must address a weakness when one exists (or finish/fix something already under way).
      passed: rank > 0 || !attention.length || ['review_weak_concept', 'fix_repeated_mistake', 'resume_quiz'].includes(rec.kind),
      severity: 'warn' as const,
    },
    {
      name: 'specific',
      passed: rec.conceptIds.length === 0 || state.concepts.some((c) => rec.conceptIds.some((id) => id.toString() === c.conceptId) && text.includes(c.name)),
      severity: 'warn' as const,
    },
    { name: 'numbers_supported', passed: numbers.length === 0, severity: 'fail' as const, detail: numbers.join(', ') },
  ];
  const failed = checks.filter((c) => !c.passed);
  await recordEvaluation({
    subjectType: 'recommendation',
    subjectId: rec._id,
    evaluator: 'rules',
    feature: 'recommend.generate',
    ownerId: rec.ownerId,
    projectId: rec.projectId,
    scores: { passRate: (checks.length - failed.length) / checks.length, aligned: checks[2].passed ? 1 : 0, actionable: checks[0].passed ? 1 : 0 },
    verdict: failed.some((c) => c.severity === 'fail') ? 'fail' : failed.length ? 'warn' : 'pass',
    flags: failed.map((c) => c.name),
    rationale: failed.map((c) => `${c.name}${'detail' in c && c.detail ? ` (${c.detail})` : ''}`).join('; ') || null,
    inputPreview: `${rec.kind} · ${JSON.stringify(rec.evidence).slice(0, 200)}`,
    outputPreview: `${rec.title} — ${rec.rationale}`,
    aiCallId: rec.aiCallId,
    promptVersion: rec.source === 'ai' ? RECOMMEND_PROMPT.version : 'rules',
  });
}

/**
 * Returns the active batch, regenerating it only when the learner's state changed. New batches are written with
 * rule text immediately (fast, deterministic) and phrased by the model in the background.
 */
export async function refreshRecommendations(project: ProjectRef, options: { now?: Date; phrase?: boolean } = {}) {
  const now = options.now ?? new Date();
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const state = await learnerState(project, now);
  const picked = rankCandidates(buildCandidates(state), await noveltyFor(project, now));
  const stateHash = stateHashOf(state, picked);
  const current = await Recommendation.find({ ...scope, status: 'active' }).sort({ priority: -1 }).lean();
  if (current.length && current.every((r) => r.stateHash === stateHash)) return current;
  if (!current.length && picked.length === 0) return [];

  await Recommendation.updateMany({ ...scope, status: 'active' }, { $set: { status: 'expired' } });
  const batchId = new Types.ObjectId();
  const docs = picked.map((c) => ({
    ownerId: project.ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    batchId,
    kind: c.kind,
    key: c.key,
    title: c.title,
    rationale: c.rationale,
    action: c.action,
    conceptIds: c.conceptIds.map(toObjectId),
    priority: c.priority,
    status: 'active' as const,
    source: 'rules' as const,
    stateHash,
    evidence: { ...c.facts, severity: c.severity, importance: c.importance },
  }));
  const created = docs.length ? (await Recommendation.insertMany(docs)).map((d) => d.toObject() as IRecommendation) : [];
  for (const [rank, rec] of created.entries()) await evaluateRecommendation(rec, state, rank).catch(() => undefined);
  if (created.length) {
    await recordEvent({
      type: 'recommendation.generated',
      ownerId: project.ownerId,
      spaceId: project.spaceId,
      projectId: project._id,
      metadata: { projectName: project.name, batchId: batchId.toString(), titles: created.map((r) => r.title), kinds: created.map((r) => r.kind) },
      eventKey: `recommendation.generated:${batchId.toString()}`,
    });
    if (options.phrase !== false) {
      await enqueueJob({
        type: 'recommendations.phrase',
        idempotencyKey: `recommendations.phrase:${batchId.toString()}`,
        payload: { batchId: batchId.toString() },
        ownerId: project.ownerId,
        projectId: project._id,
        maxAttempts: 2,
        priority: 1,
      }).catch((err) => logger.warn({ err: (err as Error).message }, 'Failed to enqueue recommendation phrasing'));
    }
  }
  return created.sort((a, b) => b.priority - a.priority);
}

const Phrased = z.object({ items: z.array(z.object({ key: z.string(), title: z.string().min(8), rationale: z.string().min(12) })) });

/** `recommendations.phrase`: natural wording from the facts; anything unsupported keeps the rule text. */
async function phraseBatch(batchId: string, jobId: string, signal: AbortSignal) {
  const recs = await Recommendation.find({ batchId: toObjectId(batchId), status: 'active' }).lean();
  if (!recs.length) return { skipped: 'batch-superseded' };
  const projectDoc = await Project.findOne({ _id: recs[0].projectId, ownerId: recs[0].ownerId }, { name: 1, learningGoal: 1, ownerId: 1, spaceId: 1 }).lean();
  if (!projectDoc) return { skipped: 'project-deleted' };
  const project = { name: projectDoc.name, goal: projectDoc.learningGoal };
  const items = recs
    .map((r) => `- key: ${r.key}\n  kind: ${r.kind}\n  action: ${r.action.label}\n  facts: ${escapePromptData(JSON.stringify(r.evidence))}\n  current text: ${r.title} — ${r.rationale}`)
    .join('\n');
  let result;
  try {
    result = await ai().structured({
      feature: 'recommend.generate',
      tier: 'light',
      promptVersion: RECOMMEND_PROMPT.version,
      system: RECOMMEND_PROMPT.system,
      contents: [{ role: 'user', parts: [{ text: RECOMMEND_PROMPT.build({ goal: truncate(project.goal, 300), projectName: project.name, items }) }] }],
      schema: Phrased,
      meta: { ownerId: recs[0].ownerId.toString(), projectId: recs[0].projectId.toString(), jobId },
      signal,
      timeoutMs: 20_000,
      inputPreview: `Recommendations for ${project.name}`,
    });
  } catch (err) {
    if (err instanceof AIError && err.kind === 'aborted') throw err;
    return { phrased: 0, fallback: 'rules' };
  }
  let phrased = 0;
  for (const item of result.data.items) {
    const rec = recs.find((r) => r.key === item.key);
    if (!rec) continue;
    const title = truncate(item.title.trim(), 90);
    const rationale = truncate(item.rationale.trim(), 260);
    // Numbers the model mentions must come from the facts; otherwise keep the rule text.
    const facts = JSON.stringify(rec.evidence);
    const unsupported = (`${title} ${rationale}`.match(/\d+(?:\.\d+)?/g) ?? []).some((n) => !facts.includes(n));
    if (unsupported) continue;
    const updated = await Recommendation.findOneAndUpdate(
      { _id: rec._id, status: 'active' },
      { $set: { title, rationale, source: 'ai', aiCallId: new Types.ObjectId(result.aiCallId) } },
      { returnDocument: 'after' },
    ).lean();
    if (updated) phrased++;
  }
  if (phrased) {
    // Learners read the phrased text, so the rule checks run again on it (the upsert replaces the template's verdict).
    const state = await learnerState(projectDoc, new Date());
    const batch = await Recommendation.find({ batchId: toObjectId(batchId), status: 'active' }).sort({ priority: -1 }).lean();
    for (const [rank, rec] of batch.entries()) if (rec.source === 'ai') await evaluateRecommendation(rec, state, rank).catch(() => undefined);
  }
  return { phrased };
}

/* ─────────────────────────────── API ─────────────────────────────── */

export function toRecommendationDto(r: IRecommendation, names: Map<string, string>) {
  const evidence = r.evidence as { material?: string | null; materialId?: string | null; firstPage?: number | null; pages?: string };
  return {
    id: r._id.toString(),
    projectId: r.projectId.toString(),
    kind: r.kind,
    title: r.title,
    rationale: r.rationale,
    action: { type: r.action.type, params: r.action.params, label: r.action.label },
    concepts: r.conceptIds.map((id) => ({ id: id.toString(), name: names.get(id.toString()) ?? 'Concept' })),
    review:
      evidence.material && evidence.pages
        ? { materialTitle: evidence.material, pages: evidence.pages, materialId: evidence.materialId ?? null, page: evidence.firstPage ?? null }
        : null,
    priority: r.priority,
    source: r.source,
    status: r.status,
    createdAt: r.createdAt,
  };
}
export type RecommendationDto = ReturnType<typeof toRecommendationDto>;

async function conceptNames(recs: IRecommendation[]) {
  const ids = [...new Set(recs.flatMap((r) => r.conceptIds.map((id) => id.toString())))];
  const concepts = ids.length ? await Concept.find({ _id: { $in: ids.map(toObjectId) } }, { name: 1 }).lean() : [];
  return new Map(concepts.map((c) => [c._id.toString(), c.name]));
}

export async function recommendationsFor(project: ProjectRef) {
  const recs = await refreshRecommendations(project);
  const names = await conceptNames(recs);
  return recs.map((r) => toRecommendationDto(r, names));
}

/** GET /projects/:projectId/recommendations */
export async function getProjectRecommendations(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const items = await recommendationsFor(project);
  const [completed, dismissed] = await Promise.all([
    Recommendation.countDocuments({ ownerId: project.ownerId, projectId: project._id, status: 'completed' }),
    Recommendation.countDocuments({ ownerId: project.ownerId, projectId: project._id, status: 'dismissed' }),
  ]);
  return { items, history: { completed, dismissed } };
}

async function transition(ownerId: string, projectId: string, recommendationId: string, status: 'completed' | 'dismissed') {
  const project = await getOwnedProject(ownerId, projectId);
  const rec = await Recommendation.findOneAndUpdate(
    { _id: toObjectId(recommendationId), ownerId: project.ownerId, projectId: project._id, status: { $in: ['active', 'expired'] } },
    { $set: { status, actedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (!rec) {
    const exists = await Recommendation.exists({ _id: toObjectId(recommendationId), ownerId: project.ownerId, projectId: project._id });
    if (!exists) throw AppError.notFound('Recommendation');
    return null; // already acted on: idempotent
  }
  await recordEvent({
    type: status === 'completed' ? 'recommendation.completed' : 'recommendation.dismissed',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: { projectName: project.name, recommendationId, title: rec.title, kind: rec.kind },
    eventKey: `recommendation.${status}:${recommendationId}`,
  });
  return rec;
}

export async function actOnRecommendation(ownerId: string, projectId: string, recommendationId: string) {
  await transition(ownerId, projectId, recommendationId, 'completed');
}

export async function dismissRecommendation(ownerId: string, projectId: string, recommendationId: string) {
  await transition(ownerId, projectId, recommendationId, 'dismissed');
  const project = await getOwnedProject(ownerId, projectId);
  return { items: await recommendationsFor(project) };
}

/** Events that change the learner's state refresh the batch in the background (idempotent per event). */
export async function enqueueRecommendationRefresh(input: { ownerId: Types.ObjectId | string; projectId: Types.ObjectId | string; reason: string }) {
  await enqueueJob({
    type: 'recommendations.generate',
    idempotencyKey: `recommendations.generate:${input.projectId.toString()}:${input.reason}`,
    payload: { projectId: input.projectId.toString() },
    ownerId: input.ownerId,
    projectId: input.projectId,
    maxAttempts: 2,
    priority: 0,
  });
}

export async function deleteProjectRecommendations(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  await Recommendation.deleteMany({ ownerId, projectId });
}

export function registerRecommendationModule() {
  registerJobHandler('recommendations.generate', async ({ job }) => {
    const project = await Project.findOne({ _id: toObjectId(String(job.payload.projectId)), ownerId: job.ownerId }).lean();
    if (!project) return { skipped: 'project-deleted' };
    const recs = await refreshRecommendations(project);
    return { active: recs.length };
  });
  registerJobHandler('recommendations.phrase', ({ job, signal }) => phraseBatch(String(job.payload.batchId), job._id.toString(), signal));

  // Zoya (and any other context composer) sees the current next steps, so advice stays consistent everywhere.
  registerContextProvider({
    id: 'recommendations',
    priority: 60,
    purposes: ['tutor'],
    async load({ ownerId, projectId }) {
      const recs = await Recommendation.find({ ownerId: toObjectId(ownerId), projectId: toObjectId(projectId), status: 'active' })
        .sort({ priority: -1 })
        .limit(3)
        .lean();
      if (!recs.length) return null;
      return { id: 'recommendations', title: 'Recommended next steps for the learner', lines: recs.map((r) => `${r.title} — ${r.rationale}`) };
    },
  });
}
