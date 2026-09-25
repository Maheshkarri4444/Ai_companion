import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { AIError, type CallMeta } from '../../ai';
import { QUIZ_GENERATE_PROMPT } from '../../ai/prompts/quiz';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { truncate } from '../../lib/text';
import { Concept } from '../../models/knowledge.model';
import { Project } from '../../models/project.model';
import { Attempt, Question, QuizSession, type IQuestion, type IQuizSession } from '../../models/quiz.model';
import { enqueueJudge } from '../evaluation/evaluation.jobs';
import { recordEvaluation, sampled } from '../evaluation/evaluation.service';
import { composeContext } from '../learning-context/providers';
import { loadConceptStates } from '../mastery/mastery.service';
import { generateQuestion, loadConceptEvidence, type EvidencePassage, type GenerationResult } from './generation';
import { seededRandom, selectNext, type Selection, type SessionState } from './selection';
import { stemHashOf } from './validation';

/*
 * "Understand current mastery → select concept / difficulty → generate question" (PRD §9). Exactly one generation
 * runs per session at a time: a lease on the session document is shared by the background pre-generation job and
 * an impatient `next` request, and a question already waiting is never generated twice.
 */

const LOCK_MS = 90_000;
const MAX_CONCEPT_TRIES = 3;

export class QuizError extends Error {
  constructor(
    readonly code: 'QUESTION_UNAVAILABLE' | 'NO_ASSESSABLE_CONCEPTS',
    message: string,
  ) {
    super(message);
    this.name = 'QuizError';
  }
}

/** Pre-generated question waiting for this session, if any. */
export const readyQuestion = (sessionId: Types.ObjectId) => Question.findOne({ sessionId, status: 'ready' }).sort({ createdAt: 1 }).lean();

const inProcess = new Map<string, Promise<IQuestion | null>>();

/**
 * Makes sure the session has a question ready: returns the waiting one, or generates one under the session
 * lease. Resolves null when another process holds the lease (its question will appear shortly) or the session
 * ended. Concurrent callers in this process share one generation.
 */
export function generateForSession(sessionId: Types.ObjectId, options: { meta?: CallMeta; signal?: AbortSignal } = {}): Promise<IQuestion | null> {
  const key = sessionId.toString();
  const running = inProcess.get(key);
  if (running) return running;
  const work = (async () => {
    const waiting = await readyQuestion(sessionId);
    if (waiting) return waiting;
    const token = randomUUID();
    const now = new Date();
    const session = await QuizSession.findOneAndUpdate(
      { _id: sessionId, status: 'active', $or: [{ 'generation.lockedUntil': null }, { 'generation.lockedUntil': { $lt: now } }] },
      { $set: { 'generation.lockedUntil': new Date(now.getTime() + LOCK_MS), 'generation.token': token } },
      { returnDocument: 'after' },
    ).lean();
    if (!session) return null;
    try {
      const raced = await readyQuestion(sessionId);
      if (raced) return raced;
      const question = await produceQuestion(session, options);
      await QuizSession.updateOne({ _id: sessionId }, { $set: { 'generation.failures': 0, 'generation.lastError': null } });
      return question;
    } catch (err) {
      const code = err instanceof QuizError ? err.code : err instanceof AIError ? `AI_${err.kind.toUpperCase()}` : 'GENERATION_FAILED';
      await QuizSession.updateOne(
        { _id: sessionId },
        { $inc: { 'generation.failures': 1 }, $set: { 'generation.lastError': { code, message: truncate((err as Error).message, 300) } } },
      );
      throw err;
    } finally {
      await QuizSession.updateOne({ _id: sessionId, 'generation.token': token }, { $set: { 'generation.lockedUntil': null, 'generation.token': null } });
    }
  })();
  inProcess.set(key, work);
  void work.catch(() => undefined).finally(() => inProcess.delete(key));
  return work;
}

async function produceQuestion(session: IQuizSession, options: { meta?: CallMeta; signal?: AbortSignal }): Promise<IQuestion> {
  const now = new Date();
  const owner = session.ownerId;
  const projectId = session.projectId;
  const meta: CallMeta = { ownerId: owner.toString(), projectId: projectId.toString(), ...options.meta };
  const project = await Project.findOne({ _id: projectId, ownerId: owner }, { learningGoal: 1 }).lean();
  if (!project) throw new QuizError('QUESTION_UNAVAILABLE', 'The Project no longer exists.');

  const [states, served, graded, history] = await Promise.all([
    loadConceptStates(owner, projectId, now),
    Question.find({ sessionId: session._id, status: { $in: ['served', 'answered'] } }, { conceptIds: 1, type: 1, position: 1 }).sort({ position: -1 }).lean(),
    Attempt.find({ sessionId: session._id, 'grading.status': 'graded' }, { outcome: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(),
    Question.find({ ownerId: owner, projectId }, { stemHash: 1, stem: 1, conceptIds: 1, 'sources.chunkId': 1 }).sort({ createdAt: -1 }).limit(400).lean(),
  ]);
  const position = served.length + 1;
  const state: SessionState = {
    mode: session.mode,
    typePreference: session.questionTypes,
    position,
    targetCount: session.targetCount,
    recentConceptIds: served.map((q) => q.conceptIds[0]?.toString()).filter((id): id is string => Boolean(id)),
    outcomes: graded.map((a) => a.outcome as number),
    openServed: served.filter((q) => q.type === 'open').length,
    focusConceptIds: session.focusConceptIds.map((id) => id.toString()),
    excludeConceptIds: [],
  };
  const usedStemHashes = new Set(history.map((q) => q.stemHash));
  // Seeded per session position: a retried generation makes the same choice (reproducible, debuggable).
  const rng = seededRandom(`${session._id.toString()}:${position}`);

  for (let attempt = 0; attempt < MAX_CONCEPT_TRIES; attempt++) {
    const selection = selectNext(states, state, rng, now);
    if (!selection) break;
    const concept = await Concept.findOne({ _id: new Types.ObjectId(selection.conceptId), ownerId: owner, projectId }).lean();
    if (!concept) {
      state.excludeConceptIds.push(selection.conceptId);
      continue;
    }
    const earlier = history.filter((q) => q.conceptIds.some((c) => c.equals(concept._id)));
    const [evidence, context] = await Promise.all([
      loadConceptEvidence({
        ownerId: owner,
        projectId,
        concept,
        usedChunkIds: earlier.flatMap((q) => q.sources.map((s) => s.chunkId?.toString() ?? '')).filter(Boolean),
        rng,
        meta,
        signal: options.signal,
      }),
      composeContext(
        { ownerId: owner.toString(), projectId: projectId.toString(), query: `${concept.name}: ${concept.description}`, purpose: 'quiz', meta, signal: options.signal },
        { budgetChars: 1500, only: ['learner_memory', 'mastery', 'assessment_history'] },
      ).catch(() => null),
    ]);
    if (evidence.length === 0) {
      state.excludeConceptIds.push(selection.conceptId);
      continue;
    }

    const result = await generateQuestion({
      concept: { name: concept.name, description: concept.description },
      type: selection.type,
      difficulty: selection.difficulty,
      cognitiveLevel: selection.cognitiveLevel,
      goal: project.learningGoal,
      learnerContext: context?.text ?? '',
      avoidStems: earlier.slice(0, 8).map((q) => q.stem),
      evidence,
      usedStemHashes,
      rng,
      meta,
      signal: options.signal,
    });
    if (!result.question) {
      await recordGenerationQuality(session, concept.name, selection, result, null);
      state.excludeConceptIds.push(selection.conceptId);
      continue;
    }
    const question = await persistQuestion(session, concept, selection, evidence, result);
    await recordGenerationQuality(session, concept.name, selection, result, question);
    return question;
  }
  throw new QuizError('QUESTION_UNAVAILABLE', "Zoya couldn't write a good question from your materials right now. Please try again.");
}

async function persistQuestion(
  session: IQuizSession,
  concept: { _id: Types.ObjectId; name: string },
  selection: Selection,
  evidence: EvidencePassage[],
  result: GenerationResult,
): Promise<IQuestion> {
  const q = result.question!;
  const cited = new Set(q.sourceIds);
  const created = await Question.create({
    ownerId: session.ownerId,
    projectId: session.projectId,
    sessionId: session._id,
    status: 'ready',
    conceptIds: [concept._id],
    conceptNames: [concept.name],
    type: q.type,
    difficulty: selection.difficulty,
    cognitiveLevel: selection.cognitiveLevel,
    stem: q.stem,
    options: q.type === 'mcq' ? q.options : [],
    correctOptionId: q.type === 'mcq' ? q.correctOptionId : null,
    explanation: q.explanation,
    rubric: q.type === 'open' ? { keyPoints: q.keyPoints, sampleAnswer: q.sampleAnswer } : null,
    sources: evidence.map((e) => ({
      ref: e.ref,
      chunkId: e.chunkId && Types.ObjectId.isValid(e.chunkId) ? new Types.ObjectId(e.chunkId) : null,
      materialId: new Types.ObjectId(e.materialId),
      materialTitle: e.materialTitle,
      pageStart: e.pageStart,
      pageEnd: e.pageEnd,
      sectionTitle: e.sectionTitle,
      snippet: truncate(e.text.replace(/\s+/g, ' ').trim(), 420),
      cited: cited.has(e.ref),
    })),
    selection: {
      priority: selection.priority,
      probability: selection.probability,
      predictedP: selection.predictedP,
      targetP: selection.targetP,
      mastery: selection.mastery,
      evidence: selection.evidence,
      explored: selection.explored,
      reason: selection.reason,
      components: selection.components,
    },
    stemHash: stemHashOf(q.stem),
    generation: {
      aiCallId: result.aiCallIds.at(-1) && Types.ObjectId.isValid(result.aiCallIds.at(-1)!) ? new Types.ObjectId(result.aiCallIds.at(-1)) : null,
      promptVersion: QUIZ_GENERATE_PROMPT.version,
      model: result.model,
      attempts: result.attempts,
      latencyMs: result.latencyMs,
      costUsd: Math.round(result.costUsd * 1e8) / 1e8,
      validation: result.validation,
      selfRated: result.selfRated,
    },
  });
  return created.toObject();
}

/**
 * Online evaluation of generation (PRD §14 "question quality, structured output reliability"): every generated
 * item gets a rules verdict; items with warnings — and a sample of the rest — go to the LLM judge.
 */
async function recordGenerationQuality(
  session: IQuizSession,
  conceptName: string,
  selection: Selection,
  result: GenerationResult,
  question: IQuestion | null,
) {
  const warnings = result.validation.warnings.filter((w) => w !== 'regenerated');
  await recordEvaluation({
    subjectType: 'quiz_question',
    subjectId: question?._id ?? null,
    evaluator: 'rules',
    feature: 'quiz.generate',
    ownerId: session.ownerId,
    projectId: session.projectId,
    scores: {
      valid: question ? 1 : 0,
      firstPass: question && result.attempts === 1 ? 1 : 0,
      clean: question && warnings.length === 0 ? 1 : 0,
    },
    verdict: !question ? 'fail' : warnings.length ? 'warn' : 'pass',
    flags: question ? result.validation.warnings : result.validation.issues,
    rationale: question ? null : `Rejected twice: ${result.validation.issues.join(', ')}`,
    inputPreview: `${conceptName} · ${selection.type} · difficulty ${selection.difficulty} · ${selection.cognitiveLevel}`,
    outputPreview: question?.stem ?? null,
    aiCallId: result.aiCallIds.at(-1) ?? null,
    promptVersion: QUIZ_GENERATE_PROMPT.version,
    model: result.model,
  });
  if (question && (warnings.length > 0 || sampled(question._id.toString(), config.QUIZ_JUDGE_SAMPLE_RATE))) {
    await enqueueJudge({ subjectType: 'quiz_question', subjectId: question._id.toString(), ownerId: session.ownerId.toString(), projectId: session.projectId.toString() }).catch((err) =>
      logger.warn({ err: (err as Error).message }, 'Failed to enqueue quiz judge'),
    );
  }
}
