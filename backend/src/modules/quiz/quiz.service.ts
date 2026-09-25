import { Types } from 'mongoose';
import { AIError, friendlyAIMessage, type CallMeta } from '../../ai';
import { enqueueJob } from '../../jobs/queue';
import { getContext } from '../../lib/context';
import { AppError, isDuplicateKeyError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sleep } from '../../lib/semaphore';
import { truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { ActivityEvent } from '../../models/activityEvent.model';
import { Chunk, Concept } from '../../models/knowledge.model';
import { Mastery, MasterySnapshot } from '../../models/mastery.model';
import { Material } from '../../models/material.model';
import { Project } from '../../models/project.model';
import {
  Attempt,
  Question,
  QuizSession,
  type IAttempt,
  type IQuestion,
  type IQuizSession,
  type QuestionTypePreference,
  type QuizMode,
} from '../../models/quiz.model';
import { recordEvent } from '../activity/activity.service';
import { enqueueJudge } from '../evaluation/evaluation.jobs';
import { recordEvaluation } from '../evaluation/evaluation.service';
import { evaluateGradingRules } from '../evaluation/quiz-rules';
import { bandOf } from '../mastery/estimator';
import { applyAttemptToMastery, conceptMastery, masterySummary } from '../mastery/mastery.service';
import { getOwnedProject } from '../projects/projects.service';
import { touchActivity } from '../workspace';
import { toAttemptDto, toQuestionDto, toSessionDto, toSummaryDto } from './dto';
import type { EvidencePassage } from './generation';
import { gradeMcq, gradeNonAnswer, gradeOpenAnswer, type GradeResult } from './grading';
import { generateForSession, QuizError, readyQuestion } from './question-factory';
import { buildSummary, computeSessionSummary, refreshSessionCounters } from './summary';
import { isNonAnswer } from './validation';

/*
 * The adaptive quiz loop (PRD §9, docs/ARCHITECTURE.md §16):
 *   start → next (pre-generated or generated now) → answer (graded: exact for MCQ, AI rubric for open-ended)
 *   → mastery update + snapshot → events (repeated-mistake / learning workflows) → next … → complete → summary.
 * Answers are idempotent (client key, one attempt per question); every derived write is repeatable, so a retry,
 * background grading or the reconciler can finish an attempt any number of times without double counting.
 */

/*
 * Synchronous waits stay well under the 30 s a reverse proxy typically allows an idle upstream request (the Next.js
 * rewrite proxy's default): beyond them the work carries on in the background — a question keeps generating under
 * its lease (the client polls `next`), an answer is graded by a job (the client polls the session).
 */
const NEXT_WAIT_MS = 20_000;
const SYNC_GRADE_MS = 22_000;

export interface StartQuizInput {
  mode: QuizMode;
  targetCount: number;
  questionTypes: QuestionTypePreference;
  conceptIds: string[];
}

export interface AnswerInput {
  idempotencyKey: string;
  optionId?: string;
  text?: string;
  skipped?: boolean;
  timeMs?: number;
}

async function getOwnedSession(ownerId: string, projectId: string, sessionId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const session = await QuizSession.findOne({ _id: toObjectId(sessionId), ownerId: project.ownerId, projectId: project._id }).lean();
  if (!session) throw AppError.notFound('Quiz');
  return { project, session };
}

const hasEvidence = (c: { chunkCount?: number; sources: Array<{ pages: number[] }> }) => (c.chunkCount ?? 0) > 0 || c.sources.some((s) => s.pages.length > 0);

/* ─────────────────────────────── Overview ─────────────────────────────── */

/** Quiz home: readiness, the session in progress, history, overall stats and concept mastery. */
export async function getQuizOverview(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const [sessions, statusRows, concepts, assessable, totals] = await Promise.all([
    QuizSession.find(scope).sort({ createdAt: -1 }).limit(30).lean(),
    Material.aggregate<{ _id: string; n: number }>([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    conceptMastery(project.ownerId, project._id),
    Concept.find(scope, { chunkCount: 1, sources: 1 }).lean(),
    Attempt.aggregate<{ _id: null; answered: number; correct: number; score: number }>([
      { $match: { ...scope, 'grading.status': 'graded' } },
      { $group: { _id: null, answered: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } }, score: { $sum: '$outcome' } } },
    ]),
  ]);
  const by = new Map(statusRows.map((r) => [r._id, r.n]));
  const active = sessions.find((s) => s.status === 'active') ?? null;
  const completed = sessions.filter((s) => s.status === 'completed');
  const t = totals[0];
  return {
    project: { id: project._id.toString(), name: project.name, learningGoal: project.learningGoal },
    readiness: {
      readyMaterials: by.get('ready') ?? 0,
      pendingMaterials: (by.get('queued') ?? 0) + (by.get('processing') ?? 0),
      conceptCount: concepts.length,
      assessableConcepts: assessable.filter(hasEvidence).length,
      canStart: assessable.some(hasEvidence),
    },
    active: active ? toSessionDto(active) : null,
    sessions: completed.slice(0, 20).map(toSessionDto),
    stats: {
      quizzesCompleted: await QuizSession.countDocuments({ ...scope, status: 'completed' }),
      questionsAnswered: t?.answered ?? 0,
      accuracy: t?.answered ? Math.round((t.correct / t.answered) * 1000) / 1000 : null,
      avgScore: t?.answered ? Math.round((t.score / t.answered) * 1000) / 1000 : null,
      lastCompletedAt: completed[0]?.completedAt ?? null,
    },
    mastery: { summary: masterySummary(concepts), concepts },
  };
}

/* ──────────────────────────────── Start ──────────────────────────────── */

async function schedulePregeneration(session: Pick<IQuizSession, '_id' | 'ownerId' | 'projectId' | 'servedCount'>) {
  await enqueueJob({
    type: 'quiz.pregenerate',
    // One pre-generation per question slot: duplicate triggers (retries, reconciler) never generate twice.
    idempotencyKey: `quiz.pregenerate:${session._id.toString()}:${session.servedCount + 1}`,
    payload: { sessionId: session._id.toString() },
    ownerId: session.ownerId,
    projectId: session.projectId,
    maxAttempts: 2,
    priority: 3,
  }).catch((err) => logger.warn({ err: (err as Error).message }, 'Failed to schedule question pre-generation'));
}

export async function startQuiz(ownerId: string, projectId: string, input: StartQuizInput) {
  const project = await getOwnedProject(ownerId, projectId);
  const owner = project.ownerId;
  const concepts = await Concept.find({ ownerId: owner, projectId: project._id }, { name: 1, chunkCount: 1, sources: 1 }).lean();
  const assessable = concepts.filter(hasEvidence);
  if (assessable.length === 0) {
    throw AppError.conflict('NO_QUIZ_MATERIAL', 'Quizzes are written from your materials. Upload a PDF and start once it has been processed.');
  }
  let focus: Types.ObjectId[] = [];
  if (input.mode === 'focused') {
    const allowed = new Map(assessable.map((c) => [c._id.toString(), c._id]));
    focus = [...new Set(input.conceptIds)].map((id) => allowed.get(id)).filter((id): id is Types.ObjectId => Boolean(id));
    if (focus.length === 0) {
      throw AppError.badRequest('Choose at least one concept from this Project to focus on.', [{ path: 'conceptIds', message: 'Choose a concept' }]);
    }
  }

  // One active quiz per Project: starting another closes the previous one (kept in history when answered).
  for (const previous of await QuizSession.find({ ownerId: owner, projectId: project._id, status: 'active' }, { _id: 1 }).lean()) {
    await completeSession(previous._id);
  }
  let session: IQuizSession;
  try {
    session = (
      await QuizSession.create({
        ownerId: owner,
        spaceId: project.spaceId,
        projectId: project._id,
        mode: input.mode,
        questionTypes: input.questionTypes,
        focusConceptIds: focus,
        targetCount: input.targetCount,
      })
    ).toObject();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // A concurrent start won the race: return its session instead of a second one.
    const active = await QuizSession.findOne({ ownerId: owner, projectId: project._id, status: 'active' }).lean();
    if (!active) throw err;
    return toSessionDto(active);
  }

  await touchActivity({ spaceId: project.spaceId, projectId: project._id });
  const names = new Map(concepts.map((c) => [c._id.toString(), c.name]));
  await recordEvent({
    type: 'quiz.started',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: {
      projectName: project.name,
      sessionId: session._id.toString(),
      mode: session.mode,
      targetCount: session.targetCount,
      questionTypes: session.questionTypes,
      focus: focus.map((id) => names.get(id.toString())).filter(Boolean),
    },
    eventKey: `quiz.started:${session._id.toString()}`,
  });
  // The first question is prepared in the background while the page loads.
  await schedulePregeneration(session);
  return toSessionDto(session);
}

/* ─────────────────────────────── Session ─────────────────────────────── */

export async function getQuizSession(ownerId: string, projectId: string, sessionId: string) {
  const { session } = await getOwnedSession(ownerId, projectId, sessionId);
  const [questions, attempts] = await Promise.all([
    Question.find({
      sessionId: session._id,
      $or: [{ status: { $in: ['served', 'answered'] } }, ...(session.currentQuestionId ? [{ _id: session.currentQuestionId }] : [])],
    })
      .sort({ position: 1, createdAt: 1 })
      .lean(),
    Attempt.find({ sessionId: session._id }).lean(),
  ]);
  const byQuestion = new Map(attempts.map((a) => [a.questionId.toString(), a]));
  const ended = session.status !== 'active';
  const summary = ended ? session.summary : buildSummary(attempts, questions);
  return {
    session: { ...toSessionDto(session), summary: toSummaryDto(summary) },
    questions: questions.map((q) => toQuestionDto(q, byQuestion.get(q._id.toString()) ?? null, { sessionEnded: ended })),
  };
}

function toUserError(err: unknown): unknown {
  if (err instanceof QuizError) return new AppError(503, err.code, err.message);
  if (err instanceof AIError) return new AppError(503, `AI_${err.kind.toUpperCase()}`, friendlyAIMessage(err.kind));
  return err;
}

async function within<T>(promise: Promise<T>, ms: number): Promise<{ value: T } | { timeout: true }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise.then((value) => ({ value })), new Promise<{ timeout: true }>((resolve) => (timer = setTimeout(() => resolve({ timeout: true }), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(sessionId: Types.ObjectId, ms: number): Promise<IQuestion | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ready = await readyQuestion(sessionId);
    if (ready) return ready;
    const session = await QuizSession.findById(sessionId, { status: 1 }).lean();
    if (session?.status !== 'active') return null;
    await sleep(400);
  }
  return null;
}

/** Marks a question as the one on screen. Only one wins when two requests race (double click, two tabs). */
async function serveQuestion(sessionId: Types.ObjectId, question: IQuestion): Promise<IQuestion> {
  const now = new Date();
  const claimed = await QuizSession.findOneAndUpdate(
    { _id: sessionId, status: 'active', currentQuestionId: null },
    { $set: { currentQuestionId: question._id, lastActivityAt: now }, $inc: { servedCount: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!claimed) {
    const fresh = await QuizSession.findById(sessionId, { currentQuestionId: 1 }).lean();
    const current = fresh?.currentQuestionId ? await Question.findById(fresh.currentQuestionId).lean() : null;
    if (current) return current;
    throw AppError.conflict('QUIZ_ENDED', 'This quiz has ended.');
  }
  const served = await Question.findOneAndUpdate(
    { _id: question._id, status: 'ready' },
    { $set: { status: 'served', position: claimed.servedCount, servedAt: now } },
    { returnDocument: 'after' },
  ).lean();
  return served ?? (await Question.findById(question._id).lean())!;
}

/**
 * The next question. Idempotent: while a question is unanswered it is returned again. A pre-generated question is
 * served instantly; otherwise one is generated now (bounded wait — beyond it the client is told to poll, and the
 * generation carries on under its lease).
 */
export async function nextQuestion(ownerId: string, projectId: string, sessionId: string) {
  const { session } = await getOwnedSession(ownerId, projectId, sessionId);
  if (session.status !== 'active') return { done: true, preparing: false, question: null, session: toSessionDto(session) };
  if (session.currentQuestionId) {
    const current = await Question.findOne({ _id: session.currentQuestionId, sessionId: session._id }).lean();
    if (current) return { done: false, preparing: false, question: toQuestionDto(current, null), session: toSessionDto(session) };
    await QuizSession.updateOne({ _id: session._id, currentQuestionId: session.currentQuestionId }, { $set: { currentQuestionId: null } });
  }
  if (session.answeredCount >= session.targetCount) {
    const completed = await completeSession(session._id);
    return { done: true, preparing: false, question: null, session: toSessionDto(completed) };
  }

  const meta: CallMeta = { ownerId, projectId, traceId: getContext()?.requestId ?? null };
  let question: IQuestion | null = await readyQuestion(session._id);
  if (!question) {
    const deadline = Date.now() + NEXT_WAIT_MS;
    let outcome: { value: IQuestion | null } | { timeout: true };
    try {
      outcome = await within(generateForSession(session._id, { meta }), NEXT_WAIT_MS);
    } catch (err) {
      throw toUserError(err);
    }
    // null: another worker holds the generation lease — wait (within the same deadline) for its question.
    if ('value' in outcome) question = outcome.value ?? (await waitForReady(session._id, deadline - Date.now()));
    if (!question) {
      const fresh = (await QuizSession.findById(session._id).lean()) ?? session;
      if (fresh.status !== 'active') return { done: true, preparing: false, question: null, session: toSessionDto(fresh) };
      return { done: false, preparing: true, question: null, session: toSessionDto(fresh) };
    }
  }
  const served = await serveQuestion(session._id, question);
  const fresh = (await QuizSession.findById(session._id).lean()) ?? session;
  return { done: false, preparing: false, question: toQuestionDto(served, null), session: toSessionDto(fresh) };
}

/* ─────────────────────────────── Answers ─────────────────────────────── */

function gradingDoc(grade: GradeResult, now = new Date()) {
  return {
    status: 'graded' as const,
    method: grade.method,
    aiCallId: grade.aiCallId && Types.ObjectId.isValid(grade.aiCallId) ? new Types.ObjectId(grade.aiCallId) : null,
    promptVersion: grade.promptVersion,
    model: grade.model,
    scores: grade.scores,
    flags: grade.flags,
    error: null,
    gradedAt: now,
  };
}

function gradedSet(grade: GradeResult) {
  const grading = gradingDoc(grade);
  return {
    outcome: grade.outcome,
    isCorrect: grade.isCorrect,
    feedback: grade.feedback,
    ...Object.fromEntries(Object.entries(grading).map(([k, v]) => [`grading.${k}`, v])),
  };
}

/** Full passage text for grading (the question stores only snippets); falls back to the snippet. */
async function gradingSources(question: IQuestion): Promise<EvidencePassage[]> {
  const ids = question.sources.map((s) => s.chunkId).filter((id): id is Types.ObjectId => Boolean(id));
  const chunks = ids.length ? await Chunk.find({ _id: { $in: ids }, ownerId: question.ownerId }, { text: 1 }).lean() : [];
  const textOf = new Map(chunks.map((c) => [c._id.toString(), c.text]));
  return question.sources.map((s) => ({
    ref: s.ref,
    chunkId: s.chunkId?.toString() ?? null,
    materialId: s.materialId.toString(),
    materialTitle: s.materialTitle,
    pageStart: s.pageStart,
    pageEnd: s.pageEnd,
    sectionTitle: s.sectionTitle,
    text: (s.chunkId && textOf.get(s.chunkId.toString())) || s.snippet,
  }));
}

function answerResponse(result: { attempt: IAttempt; question: IQuestion; session: IQuizSession }) {
  return {
    attempt: toAttemptDto(result.attempt),
    question: toQuestionDto(result.question, result.attempt),
    session: toSessionDto(result.session),
    done: result.session.status !== 'active',
  };
}

async function replay(existing: IAttempt, input: AnswerInput, questionId: Types.ObjectId) {
  if (!existing.questionId.equals(questionId)) {
    throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'This answer id was already used for another question.');
  }
  if (existing.idempotencyKey !== input.idempotencyKey) throw AppError.conflict('ALREADY_ANSWERED', 'You have already answered this question.');
  const [question, session] = await Promise.all([Question.findById(existing.questionId).lean(), QuizSession.findById(existing.sessionId).lean()]);
  if (!question || !session) throw AppError.notFound('Quiz');
  return answerResponse({ attempt: existing, question, session });
}

export async function submitAnswer(ownerId: string, projectId: string, sessionId: string, questionId: string, input: AnswerInput) {
  const { project, session } = await getOwnedSession(ownerId, projectId, sessionId);
  const question = await Question.findOne({ _id: toObjectId(questionId), sessionId: session._id, ownerId: project.ownerId }).lean();
  if (!question) throw AppError.notFound('Question');
  const existing = await Attempt.findOne({ questionId: question._id }).lean();
  if (existing) return replay(existing, input, question._id);
  if (session.status !== 'active') throw AppError.conflict('QUIZ_ENDED', 'This quiz has already ended.');
  if (!session.currentQuestionId?.equals(question._id)) {
    throw AppError.conflict('NOT_CURRENT_QUESTION', 'This question is not the one currently being asked.');
  }

  const text = input.text?.trim() ?? '';
  const skipped = Boolean(input.skipped) || (question.type === 'open' && isNonAnswer(text));
  if (!skipped && question.type === 'mcq' && !question.options.some((o) => o.id === input.optionId)) {
    throw AppError.badRequest('Choose one of the options.', [{ path: 'optionId', message: 'Choose an option' }]);
  }
  const immediate: GradeResult | null = skipped ? gradeNonAnswer(question) : question.type === 'mcq' ? gradeMcq(question, input.optionId!) : null;

  // Claim the question first (unique per question), then grade: a double submit can never be graded twice.
  let attempt: IAttempt;
  try {
    attempt = (
      await Attempt.create({
        ownerId: project.ownerId,
        projectId: project._id,
        sessionId: session._id,
        questionId: question._id,
        conceptIds: question.conceptIds,
        type: question.type,
        difficulty: question.difficulty,
        cognitiveLevel: question.cognitiveLevel,
        response: {
          optionId: question.type === 'mcq' && !skipped ? input.optionId : null,
          text: question.type === 'open' && text ? text : null,
          skipped,
        },
        timeMs: input.timeMs ?? null,
        idempotencyKey: input.idempotencyKey,
        ...(immediate
          ? { outcome: immediate.outcome, isCorrect: immediate.isCorrect, feedback: immediate.feedback, grading: { ...gradingDoc(immediate), attempts: 0 } }
          : { grading: { status: 'pending', method: 'ai', attempts: 0 } }),
      })
    ).toObject();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await Attempt.findOne({ $or: [{ questionId: question._id }, { ownerId: project.ownerId, idempotencyKey: input.idempotencyKey }] }).lean();
    if (!raced) throw err;
    return replay(raced, input, question._id);
  }

  if (!immediate) {
    try {
      const grade = await gradeOpenAnswer({
        question,
        answer: text,
        sources: await gradingSources(question),
        meta: { ownerId, projectId, traceId: getContext()?.requestId ?? null },
        // Overall deadline across retries and fallbacks; a slower grade finishes in the background.
        signal: AbortSignal.timeout(SYNC_GRADE_MS),
      });
      await Attempt.updateOne({ _id: attempt._id, 'grading.status': 'pending' }, { $set: gradedSet(grade), $inc: { 'grading.attempts': 1 } });
    } catch (err) {
      // The answer is safe; grading finishes in the background (the learner sees "grading…").
      const code = err instanceof AIError ? `AI_${err.kind.toUpperCase()}` : 'GRADING_FAILED';
      logger.warn({ err: (err as Error).message, attemptId: attempt._id.toString() }, 'Open answer grading deferred');
      await Attempt.updateOne(
        { _id: attempt._id },
        { $inc: { 'grading.attempts': 1 }, $set: { 'grading.error': { code, message: truncate((err as Error).message, 300) } } },
      );
      // If even the enqueue fails, the reconciler finds the pending answer and schedules its grading.
      await enqueueGrading(attempt).catch((e) => logger.warn({ err: (e as Error).message }, 'Failed to schedule background grading'));
    }
  }
  const result = await finalizeAttempt(attempt._id);
  if (!result) throw AppError.notFound('Quiz');
  return answerResponse(result);
}

function enqueueGrading(attempt: Pick<IAttempt, '_id' | 'ownerId' | 'projectId'>) {
  return enqueueJob({
    type: 'quiz.grade',
    idempotencyKey: `quiz.grade:${attempt._id.toString()}`,
    payload: { attemptId: attempt._id.toString() },
    ownerId: attempt.ownerId,
    projectId: attempt.projectId,
    maxAttempts: 5,
    priority: 2,
  });
}

/**
 * Everything that follows a graded (or failed) answer, safe to repeat: mastery (exactly once), events, the
 * question marked answered, the session moved on — completed after the last question, otherwise the next
 * question is pre-generated while the learner reads the feedback.
 */
export async function finalizeAttempt(attemptId: Types.ObjectId): Promise<{ attempt: IAttempt; question: IQuestion; session: IQuizSession } | null> {
  let attempt = await Attempt.findById(attemptId).lean();
  if (!attempt) return null;
  const question = await Question.findById(attempt.questionId).lean();
  if (!question) return null;

  if (attempt.grading.status === 'graded' && !attempt.masteryApplied) {
    // Mastery is applied exactly once (a repeat returns the recorded delta) and the follow-ups are idempotent, so
    // the flag is set last: a crash in between leaves it false and the reconciler simply runs this again.
    const deltas = await applyAttemptToMastery(attempt, question.conceptNames);
    await afterGraded({ ...attempt, masteryDelta: deltas }, question);
    attempt = (await Attempt.findOneAndUpdate({ _id: attempt._id }, { $set: { masteryApplied: true, masteryDelta: deltas } }, { returnDocument: 'after' }).lean()) ?? attempt;
  }

  await Question.updateOne({ _id: question._id, status: { $in: ['served', 'ready'] } }, { $set: { status: 'answered', answeredAt: attempt.createdAt } });
  await QuizSession.updateOne({ _id: attempt.sessionId, currentQuestionId: question._id }, { $set: { currentQuestionId: null, lastActivityAt: new Date() } });
  let session = await refreshSessionCounters(attempt.sessionId);
  if (!session) return null;
  if (session.status === 'active' && session.answeredCount >= session.targetCount) {
    session = await completeSession(session._id);
  } else if (session.status === 'active') {
    await schedulePregeneration(session);
  } else if (session.status === 'completed') {
    // A late grade (background grading) refreshes the stored results.
    const summary = await computeSessionSummary(session._id);
    session = (await QuizSession.findOneAndUpdate({ _id: session._id }, { $set: { summary } }, { returnDocument: 'after' }).lean()) ?? session;
  }
  return { attempt, question: (await Question.findById(question._id).lean()) ?? question, session };
}

/** Events for a graded answer (each recorded once): the answer itself, and mastery that changed band. */
async function afterGraded(attempt: IAttempt, question: IQuestion) {
  const project = await Project.findOne({ _id: attempt.projectId, ownerId: attempt.ownerId }, { name: 1, spaceId: 1 }).lean();
  if (!project) return;
  await recordEvent({
    type: 'quiz.question_answered',
    ownerId: attempt.ownerId,
    spaceId: project.spaceId,
    projectId: attempt.projectId,
    metadata: {
      projectName: project.name,
      sessionId: attempt.sessionId.toString(),
      questionId: question._id.toString(),
      attemptId: attempt._id.toString(),
      conceptIds: attempt.conceptIds.map((c) => c.toString()),
      conceptNames: question.conceptNames,
      type: attempt.type,
      difficulty: attempt.difficulty,
      cognitiveLevel: attempt.cognitiveLevel,
      outcome: attempt.outcome,
      isCorrect: attempt.isCorrect,
      grading: attempt.grading.method,
    },
    eventKey: `quiz.question_answered:${attempt._id.toString()}`,
  });
  for (const delta of attempt.masteryDelta ?? []) {
    const previous = bandOf(delta.before);
    const band = bandOf(delta.after);
    if (previous === band) continue;
    await recordEvent({
      type: 'mastery.updated',
      ownerId: attempt.ownerId,
      spaceId: project.spaceId,
      projectId: attempt.projectId,
      metadata: {
        projectName: project.name,
        conceptId: delta.conceptId.toString(),
        conceptName: delta.name,
        before: delta.before,
        after: delta.after,
        band,
        previousBand: previous,
        sessionId: attempt.sessionId.toString(),
      },
      eventKey: `mastery.updated:${attempt._id.toString()}:${delta.conceptId.toString()}`,
    });
  }
  if (attempt.grading.method === 'ai') await evaluateGradingRules(attempt, question);
}

/** Background grading (`quiz.grade`): retried with backoff; after the last attempt the answer is marked ungradable. */
export async function gradePendingAttempt(attemptId: string, ctx: { jobId: string; signal: AbortSignal; lastAttempt: boolean }) {
  const attempt = await Attempt.findById(toObjectId(attemptId)).lean();
  if (!attempt) return { skipped: 'attempt-deleted' };
  if (attempt.grading.status !== 'pending') {
    await finalizeAttempt(attempt._id);
    return { skipped: `already-${attempt.grading.status}` };
  }
  const question = await Question.findById(attempt.questionId).lean();
  if (!question) return { skipped: 'question-deleted' };
  try {
    const grade = await gradeOpenAnswer({
      question,
      answer: attempt.response.text ?? '',
      sources: await gradingSources(question),
      meta: { ownerId: attempt.ownerId.toString(), projectId: attempt.projectId.toString(), jobId: ctx.jobId },
      signal: ctx.signal,
    });
    await Attempt.updateOne({ _id: attempt._id, 'grading.status': 'pending' }, { $set: gradedSet(grade), $inc: { 'grading.attempts': 1 } });
  } catch (err) {
    if (err instanceof AIError && err.kind === 'aborted') throw err;
    const retry = !ctx.lastAttempt && (!(err instanceof AIError) || err.retryable);
    await Attempt.updateOne(
      { _id: attempt._id },
      {
        $inc: { 'grading.attempts': 1 },
        $set: { 'grading.error': { code: err instanceof AIError ? `AI_${err.kind.toUpperCase()}` : 'GRADING_FAILED', message: truncate((err as Error).message, 300) } },
      },
    );
    if (retry) throw err;
    await markUngradable(attempt._id, question);
  }
  const done = await finalizeAttempt(attempt._id);
  return { status: done?.attempt.grading.status ?? null, outcome: done?.attempt.outcome ?? null };
}

/** Gives up on grading an answer: it stays in the history with the model answer but never counts towards mastery. */
async function markUngradable(attemptId: Types.ObjectId, question: Pick<IQuestion, 'rubric'> | null) {
  await Attempt.updateOne(
    { _id: attemptId, 'grading.status': 'pending' },
    {
      $set: {
        'grading.status': 'failed',
        feedback: {
          summary: "We couldn't grade this answer automatically, so it doesn't count towards your mastery. Compare it with the model answer below.",
          understood: [],
          missing: question?.rubric?.keyPoints ?? [],
          misconceptions: [],
          keyPoints: [],
        },
      },
    },
  );
}

/* ─────────────────────────────── Complete ─────────────────────────────── */

/** Ends a session (idempotent): completed with a summary when anything was answered, otherwise abandoned. */
export async function completeSession(sessionId: Types.ObjectId): Promise<IQuizSession> {
  const counters = await refreshSessionCounters(sessionId);
  if (!counters) throw AppError.notFound('Quiz');
  if (counters.status !== 'active') return counters;
  const answered = counters.answeredCount > 0;
  const summary = answered ? await computeSessionSummary(sessionId) : null;
  const updated = await QuizSession.findOneAndUpdate(
    { _id: sessionId, status: 'active' },
    {
      $set: {
        status: answered ? 'completed' : 'abandoned',
        summary,
        completedAt: new Date(),
        currentQuestionId: null,
        'generation.lockedUntil': null,
        'generation.token': null,
      },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) return (await QuizSession.findById(sessionId).lean()) ?? counters;
  await Question.updateMany({ sessionId, status: { $in: ['ready', 'served'] } }, { $set: { status: 'discarded' } });
  if (updated.status === 'completed') {
    await touchActivity({ spaceId: updated.spaceId, projectId: updated.projectId });
    await recordCompletion(updated);
  }
  return updated;
}

const completionKey = (sessionId: Types.ObjectId) => `quiz.completed:${sessionId.toString()}`;

/** The `quiz.completed` event (once per session) — it starts the learning-context workflow. */
async function recordCompletion(session: IQuizSession) {
  if (!session.summary) return;
  const project = await Project.findOne({ _id: session.projectId, ownerId: session.ownerId }, { name: 1 }).lean();
  await recordEvent({
    type: 'quiz.completed',
    ownerId: session.ownerId,
    spaceId: session.spaceId,
    projectId: session.projectId,
    metadata: {
      projectName: project?.name ?? null,
      sessionId: session._id.toString(),
      mode: session.mode,
      answered: session.summary.answered,
      correct: session.summary.correct,
      accuracy: session.summary.accuracy,
      avgScore: session.summary.avgScore,
      strengths: session.summary.strengths,
      needsWork: session.summary.needsWork,
    },
    eventKey: completionKey(session._id),
  });
}

export async function completeQuiz(ownerId: string, projectId: string, sessionId: string) {
  const { session } = await getOwnedSession(ownerId, projectId, sessionId);
  const ended = session.status === 'active' ? await completeSession(session._id) : session;
  return toSessionDto(ended);
}

/* ─────────────────────────────── Reports ─────────────────────────────── */

export async function reportQuizItem(
  ownerId: string,
  projectId: string,
  sessionId: string,
  questionId: string,
  input: { target: 'question' | 'grading'; reason: string; comment?: string },
) {
  const { project, session } = await getOwnedSession(ownerId, projectId, sessionId);
  const question = await Question.findOne({ _id: toObjectId(questionId), sessionId: session._id, ownerId: project.ownerId }).lean();
  if (!question) throw AppError.notFound('Question');
  const attempt = await Attempt.findOne({ questionId: question._id }).lean();
  if (!attempt) throw AppError.conflict('NOT_ANSWERED', 'Answer the question before reporting a problem with it.');
  // Only AI grading can be disputed; for exact grading the complaint is about the answer key itself.
  const target = input.target === 'grading' && attempt.grading.method === 'ai' ? 'grading' : 'question';
  const updated = await Attempt.findOneAndUpdate(
    { _id: attempt._id },
    { $set: { report: { target, reason: input.reason, comment: input.comment ?? null, at: new Date() } } },
    { returnDocument: 'after' },
  ).lean();
  await recordEvaluation({
    subjectType: target === 'grading' ? 'quiz_grading' : 'quiz_question',
    subjectId: target === 'grading' ? attempt._id : question._id,
    evaluator: 'learner_feedback',
    feature: target === 'grading' ? 'quiz.grade' : 'quiz.generate',
    ownerId: project.ownerId,
    projectId: project._id,
    scores: { helpful: 0 },
    verdict: 'fail',
    flags: [input.reason],
    rationale: input.comment ?? null,
    inputPreview: question.stem,
    outputPreview: target === 'grading' ? (attempt.response.text ?? null) : question.explanation,
    aiCallId: target === 'grading' ? attempt.grading.aiCallId : question.generation?.aiCallId,
    promptVersion: target === 'grading' ? attempt.grading.promptVersion : question.generation?.promptVersion,
    model: target === 'grading' ? attempt.grading.model : question.generation?.model,
  });
  // A reported question is always reviewed by the judge (idempotent: at most one verdict per question).
  if (target === 'question') {
    await enqueueJudge({ subjectType: 'quiz_question', subjectId: question._id.toString(), ownerId: project.ownerId.toString(), projectId: project._id.toString(), priority: 0 });
  }
  return { attempt: toAttemptDto(updated ?? attempt) };
}

/* ───────────────────────────── Maintenance ───────────────────────────── */

/**
 * Reconciler: finishes answers a crash or an outage left half-done, and restarts the learning workflow of quizzes
 * whose completion event was lost (events are best-effort; the work they trigger must not be).
 */
export async function reconcileQuizAttempts() {
  const now = Date.now();
  const pending = await Attempt.find({ 'grading.status': 'pending', updatedAt: { $lt: new Date(now - 2 * 60_000) } }, { ownerId: 1, projectId: 1, questionId: 1 })
    .limit(100)
    .lean();
  let ungradable = 0;
  for (const attempt of pending) {
    try {
      const { job, created } = await enqueueGrading(attempt);
      if (created || !['failed', 'cancelled', 'succeeded'].includes(job.status)) continue;
      // Its grading job ended without settling the answer (e.g. interrupted on its last try): stop waiting.
      await markUngradable(attempt._id, await Question.findById(attempt.questionId, { rubric: 1 }).lean());
      await finalizeAttempt(attempt._id);
      ungradable++;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Pending grading reconciliation failed');
    }
  }

  const unapplied = await Attempt.find({ masteryApplied: false, 'grading.status': 'graded', updatedAt: { $lt: new Date(now - 60_000) } }, { _id: 1 })
    .limit(100)
    .lean();
  let finalized = 0;
  for (const attempt of unapplied) {
    if (await finalizeAttempt(attempt._id).catch((err) => logger.warn({ err: (err as Error).message }, 'Attempt reconciliation failed'))) finalized++;
  }

  const completed = await QuizSession.find({ status: 'completed', completedAt: { $gte: new Date(now - 86_400_000), $lt: new Date(now - 60_000) } })
    .sort({ completedAt: -1 })
    .limit(50)
    .lean();
  let restarted = 0;
  if (completed.length) {
    const keys = completed.map((s) => completionKey(s._id));
    const recorded = new Set((await ActivityEvent.find({ eventKey: { $type: 'string', $in: keys } }, { eventKey: 1 }).lean()).map((e) => e.eventKey));
    for (const session of completed.filter((s) => !recorded.has(completionKey(s._id)))) {
      await recordCompletion(session);
      restarted++;
    }
  }
  return { pendingGradings: pending.length, ungradableAnswers: ungradable, finalizedAttempts: finalized, restartedWorkflows: restarted };
}

/** Everything the quiz stored for a Project (used by the cascade; queued quiz jobs are cancelled with the Project's). */
export async function deleteProjectQuizData(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  await Promise.all([
    QuizSession.deleteMany({ ownerId, projectId }),
    Question.deleteMany({ ownerId, projectId }),
    Attempt.deleteMany({ ownerId, projectId }),
    Mastery.deleteMany({ ownerId, projectId }),
    MasterySnapshot.deleteMany({ ownerId, projectId }),
  ]);
}
