import { z } from 'zod';
import { ai, AIError } from '../../ai';
import { MISTAKE_PATTERN_PROMPT } from '../../ai/prompts/quiz';
import { enqueueJob, JobError } from '../../jobs/queue';
import { escapePromptData, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import type { IActivityEvent } from '../../models/activityEvent.model';
import { Concept } from '../../models/knowledge.model';
import { Mastery } from '../../models/mastery.model';
import { Attempt, Question, QuizSession } from '../../models/quiz.model';
import { rememberLearning, resolveLearning, type RememberItem } from '../learning-context/learning-context.service';
import { masteryOf, weakestLevel } from '../mastery/estimator';
import { computeSessionSummary } from './summary';

/*
 * Learning workflows (PRD §13, docs/ARCHITECTURE.md §10–§11), triggered by quiz events:
 *   Quiz completed  → evaluate (wait for every answer to be graded) → mastery (already updated per answer)
 *                   → detect weaknesses / strengths → update learning context (remember, retire what is mastered)
 *   Repeated mistake → identify the pattern (light model, rule fallback) → learning context `mistake_pattern`
 * The Tutor and the quiz generator read that context back through the context providers.
 */

/** "Repeated": at least 2 of the learner's last 4 graded answers on the concept are wrong (this one included). */
export async function onQuestionAnswered(event: IActivityEvent) {
  const meta = event.metadata as { attemptId?: string; conceptIds?: string[]; outcome?: number | null };
  const conceptId = meta.conceptIds?.[0];
  if (!meta.attemptId || !conceptId || meta.outcome == null || meta.outcome >= 0.5) return;
  const recent = await Attempt.find(
    { ownerId: event.ownerId, projectId: event.projectId, conceptIds: toObjectId(conceptId), 'grading.status': 'graded' },
    { outcome: 1 },
  )
    .sort({ createdAt: -1 })
    .limit(4)
    .lean();
  if (recent.filter((a) => (a.outcome ?? 1) < 0.5).length < 2) return;
  await enqueueJob({
    type: 'learning.repeated_mistake',
    idempotencyKey: `learning.repeated_mistake:${conceptId}:${meta.attemptId}`,
    payload: { attemptId: meta.attemptId, conceptId },
    ownerId: event.ownerId,
    projectId: event.projectId,
    maxAttempts: 3,
    priority: -1,
  });
}

export async function onQuizCompleted(event: IActivityEvent) {
  const sessionId = (event.metadata as { sessionId?: string }).sessionId;
  if (!sessionId) return;
  await enqueueJob({
    type: 'learning.update',
    idempotencyKey: `learning.update:${sessionId}`,
    payload: { sessionId },
    ownerId: event.ownerId,
    projectId: event.projectId,
    // Waits (with backoff) while answers of the session are still being graded in the background.
    maxAttempts: 6,
    priority: -1,
  });
}

const pct = (x: number) => Math.round(x * 100);

function levelAccuracy(stats: Array<{ n: number; sum: number } | undefined>) {
  const n = stats.reduce((s, x) => s + (x?.n ?? 0), 0);
  const sum = stats.reduce((s, x) => s + (x?.sum ?? 0), 0);
  return { n, accuracy: n ? sum / n : null };
}

/** `learning.update` */
export async function runLearningUpdate(sessionId: string, ctx: { jobId: string; signal: AbortSignal; lastAttempt?: boolean }) {
  const session = await QuizSession.findById(toObjectId(sessionId)).lean();
  if (!session) return { skipped: 'session-deleted' };
  if (session.status !== 'completed') return { skipped: `status-${session.status}` };
  const pending = await Attempt.countDocuments({ sessionId: session._id, 'grading.status': 'pending' });
  // Wait for background grading; on the last try go ahead with what is graded rather than learn nothing.
  if (pending && !ctx.lastAttempt) throw new JobError('GRADING_PENDING', `${pending} answer(s) are still being graded`, true);

  const owner = session.ownerId;
  const projectId = session.projectId;
  const summary = session.summary ?? (await computeSessionSummary(session._id));
  const conceptIds = summary.byConcept.map((c) => c.conceptId);
  const [masteries, concepts] = await Promise.all([
    Mastery.find({ ownerId: owner, projectId, conceptId: { $in: conceptIds } }).lean(),
    Concept.find({ ownerId: owner, projectId, _id: { $in: conceptIds } }, { name: 1 }).lean(),
  ]);
  const nameOf = new Map(concepts.map((c) => [c._id.toString(), c.name]));
  const now = new Date();
  const items: RememberItem[] = [];
  const mastered: string[] = [];

  for (const m of masteries) {
    const id = m.conceptId.toString();
    const name = nameOf.get(id);
    const mastery = masteryOf(m, now);
    if (!name || mastery === null) continue;
    const n = m.evidenceCount;
    if (mastery >= 0.8 && n >= 3) {
      items.push({ kind: 'strength', content: `Strong grasp of ${name} (${pct(mastery)}% mastery over ${n} assessed answers)`, conceptIds: [id], salience: 0.5 });
      mastered.push(id);
      continue;
    }
    if (mastery < 0.5 && n >= 2) {
      const weakest = weakestLevel(m.byLevel);
      items.push({
        kind: 'weakness',
        content: `Needs more practice on ${name}: ${pct(mastery)}% mastery after ${n} assessed answers${weakest && weakest.accuracy < 0.6 ? `, weakest on ${weakest.level} questions` : ''}`,
        conceptIds: [id],
        salience: 0.75,
      });
      continue;
    }
    // "Recall is strong but application is weak" — the insight a single score hides.
    const lower = levelAccuracy([m.byLevel?.recall, m.byLevel?.understand]);
    const higher = levelAccuracy([m.byLevel?.apply, m.byLevel?.analyze]);
    if (lower.n >= 2 && higher.n >= 2 && (lower.accuracy ?? 0) >= 0.75 && (higher.accuracy ?? 1) < 0.5) {
      items.push({
        kind: 'weakness',
        content: `Knows the facts of ${name} but struggles to apply them (${pct(higher.accuracy ?? 0)}% on application questions)`,
        conceptIds: [id],
        salience: 0.7,
      });
    }
  }
  const earlier = await QuizSession.countDocuments({ ownerId: owner, projectId, status: 'completed', completedAt: { $lt: session.completedAt ?? now } });
  if (earlier === 0 && summary.graded > 0) {
    items.push({ kind: 'milestone', content: `Completed a first adaptive quiz in this Project (${summary.correct}/${summary.graded} correct)`, salience: 0.4 });
  }

  const meta = { ownerId: owner.toString(), projectId: projectId.toString(), jobId: ctx.jobId };
  const remembered = items.length
    ? await rememberLearning({ ownerId: owner, projectId, items, source: { type: 'quiz', refId: sessionId }, meta, signal: ctx.signal })
    : { created: 0, reinforced: 0 };
  // Mastered concepts retire their old weaknesses and mistake patterns (they stop being recalled).
  const resolved = mastered.length
    ? await resolveLearning({ ownerId: owner.toString(), projectId: projectId.toString(), conceptIds: mastered, kinds: ['weakness', 'mistake_pattern'] })
    : 0;
  return {
    ...remembered,
    resolved,
    weaknesses: items.filter((i) => i.kind === 'weakness').length,
    strengths: items.filter((i) => i.kind === 'strength').length,
  };
}

const PatternOutput = z.object({ pattern: z.string().min(8), salience: z.number().min(0).max(1) });

/** `learning.repeated_mistake` */
export async function runRepeatedMistake(payload: { attemptId: string; conceptId: string }, ctx: { jobId: string; signal: AbortSignal }) {
  const trigger = await Attempt.findById(toObjectId(payload.attemptId), { ownerId: 1, projectId: 1 }).lean();
  if (!trigger) return { skipped: 'attempt-deleted' };
  const conceptId = toObjectId(payload.conceptId);
  const concept = await Concept.findOne({ _id: conceptId, ownerId: trigger.ownerId, projectId: trigger.projectId }, { name: 1 }).lean();
  if (!concept) return { skipped: 'concept-deleted' };
  const recent = await Attempt.find({ ownerId: trigger.ownerId, projectId: trigger.projectId, conceptIds: conceptId, 'grading.status': 'graded' })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();
  const wrong = recent.filter((a) => (a.outcome ?? 1) < 0.5);
  if (wrong.length < 2) return { skipped: 'not-repeated' };

  const questions = new Map((await Question.find({ _id: { $in: wrong.map((a) => a.questionId) } }).lean()).map((q) => [q._id.toString(), q]));
  const evidence = wrong
    .map((a) => {
      const q = questions.get(a.questionId.toString());
      if (!q) return null;
      const chosen = q.options.find((o) => o.id === a.response.optionId);
      const answer = a.response.skipped
        ? 'Learner did not know the answer.'
        : q.type === 'mcq'
          ? `Learner chose: "${chosen?.text ?? '?'}" (why it is wrong: ${chosen?.rationale ?? 'n/a'})`
          : `Learner wrote: "${truncate(a.response.text ?? '', 400)}"; missing: ${(a.feedback?.missing ?? []).join('; ') || 'n/a'}`;
      return `- [${q.cognitiveLevel}, difficulty ${q.difficulty}] Q: ${truncate(q.stem, 300)}\n  ${answer}`;
    })
    .filter(Boolean)
    .join('\n');

  let pattern = `Repeatedly answers questions on ${concept.name} incorrectly (${wrong.length} of the last ${recent.length})`;
  let salience = 0.8;
  let method: 'ai' | 'rule' = 'rule';
  try {
    const result = await ai().structured({
      feature: 'insight.generate',
      tier: 'light',
      promptVersion: MISTAKE_PATTERN_PROMPT.version,
      system: MISTAKE_PATTERN_PROMPT.system,
      contents: [{ role: 'user', parts: [{ text: MISTAKE_PATTERN_PROMPT.build({ concept: concept.name, mistakes: escapePromptData(evidence) }) }] }],
      schema: PatternOutput,
      meta: { ownerId: trigger.ownerId.toString(), projectId: trigger.projectId.toString(), jobId: ctx.jobId },
      signal: ctx.signal,
      timeoutMs: 20_000,
      inputPreview: `Mistake pattern: ${concept.name}`,
    });
    pattern = truncate(result.data.pattern.trim(), 240);
    salience = result.data.salience;
    method = 'ai';
  } catch (err) {
    if (err instanceof AIError && err.kind === 'aborted') throw err;
    // The rule-based statement still carries the signal; the pattern wording is a refinement.
  }
  const stored = await rememberLearning({
    ownerId: trigger.ownerId,
    projectId: trigger.projectId,
    items: [{ kind: 'mistake_pattern', content: pattern, conceptIds: [payload.conceptId], salience: Math.max(0.6, salience) }],
    source: { type: 'quiz', refId: payload.attemptId },
    meta: { ownerId: trigger.ownerId.toString(), projectId: trigger.projectId.toString(), jobId: ctx.jobId },
    signal: ctx.signal,
  });
  return { pattern, method, ...stored };
}
