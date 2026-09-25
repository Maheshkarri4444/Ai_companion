import type { Types } from 'mongoose';
import { isDuplicateKeyError } from '../../lib/errors';
import { sleep } from '../../lib/semaphore';
import { Chunk, Concept } from '../../models/knowledge.model';
import { Mastery, MasterySnapshot, type IMastery } from '../../models/mastery.model';
import { Message } from '../../models/message.model';
import { COGNITIVE_LEVELS, type IAttempt, type IMasteryDelta } from '../../models/quiz.model';
import { getOwnedProject } from '../projects/projects.service';
import type { ConceptState } from '../quiz/selection';
import { applyEvidence, bandOf, confidenceOf, effectiveTheta, masteryOf, masterySummary, sigmoid, weakestLevel } from './estimator';

export { masterySummary };

/*
 * Mastery persistence (docs/ARCHITECTURE.md §17). Updates are read-modify-write with an optimistic version check
 * and an "already applied" guard, so concurrent answers never overwrite each other and a retried update (job
 * retry, reconciler, duplicate request) is applied exactly once. Every update writes a snapshot for growth analysis.
 */

const MAX_UPDATE_RETRIES = 6;
const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

async function ensureMastery(ownerId: Types.ObjectId, projectId: Types.ObjectId, conceptId: Types.ObjectId): Promise<IMastery> {
  const existing = await Mastery.findOne({ ownerId, projectId, conceptId }).lean();
  if (existing) return existing;
  try {
    return (await Mastery.create({ ownerId, projectId, conceptId })).toObject();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    return (await Mastery.findOne({ ownerId, projectId, conceptId }).lean())!;
  }
}

type AppliedAttempt = Pick<IAttempt, '_id' | 'ownerId' | 'projectId' | 'sessionId' | 'conceptIds' | 'outcome' | 'isCorrect' | 'difficulty' | 'type' | 'cognitiveLevel'>;

async function writeSnapshot(attempt: AppliedAttempt, conceptId: Types.ObjectId, state: { theta: number; evidenceCount: number }) {
  await MasterySnapshot.create({
    ownerId: attempt.ownerId,
    projectId: attempt.projectId,
    conceptId,
    mastery: round(sigmoid(state.theta)),
    theta: state.theta,
    evidenceCount: state.evidenceCount,
    cause: { type: 'attempt', attemptId: attempt._id, sessionId: attempt.sessionId ?? null },
  }).catch((err) => {
    if (!isDuplicateKeyError(err)) throw err;
  });
}

async function deltaFromSnapshots(conceptId: Types.ObjectId, name: string, attemptId: Types.ObjectId): Promise<IMasteryDelta | null> {
  const snapshot = await MasterySnapshot.findOne({ conceptId, 'cause.attemptId': attemptId }).lean();
  if (!snapshot) return null;
  const previous = await MasterySnapshot.findOne({ conceptId, createdAt: { $lt: snapshot.createdAt } })
    .sort({ createdAt: -1 })
    .lean();
  return {
    conceptId,
    name,
    before: previous ? previous.mastery : null,
    after: snapshot.mastery,
    thetaBefore: previous?.theta ?? 0,
    thetaAfter: snapshot.theta,
  };
}

/** The delta of an attempt that was already applied (a retry, the reconciler, or a concurrent finisher). */
async function appliedDelta(doc: IMastery, name: string, attempt: AppliedAttempt): Promise<IMasteryDelta> {
  const conceptId = doc.conceptId;
  let delta = await deltaFromSnapshots(conceptId, name, attempt._id);
  if (!delta) {
    // A concurrent finisher may be writing the snapshot right now.
    await sleep(250);
    delta = await deltaFromSnapshots(conceptId, name, attempt._id);
  }
  if (!delta && doc.appliedAttemptIds.at(-1)?.equals(attempt._id)) {
    // Crashed between the update and its snapshot: the document still holds exactly this attempt's result.
    await writeSnapshot(attempt, conceptId, doc);
    delta = await deltaFromSnapshots(conceptId, name, attempt._id);
  }
  return delta ?? { conceptId, name, before: null, after: round(sigmoid(doc.theta)), thetaBefore: doc.theta, thetaAfter: doc.theta };
}

/**
 * Folds one graded attempt into the mastery of every concept it assessed. Decay is consolidated when new evidence
 * arrives (the update starts from the decayed ability), so a wrong answer after a long break never *raises* the
 * displayed mastery.
 */
export async function applyAttemptToMastery(attempt: AppliedAttempt, conceptNames: string[], now = new Date()): Promise<IMasteryDelta[]> {
  if (attempt.outcome === null || attempt.outcome === undefined) return [];
  const deltas: IMasteryDelta[] = [];
  for (const [i, conceptId] of attempt.conceptIds.entries()) {
    const name = conceptNames[i] ?? conceptNames[0] ?? 'Concept';
    let applied: IMasteryDelta | null = null;
    for (let retry = 0; retry < MAX_UPDATE_RETRIES && !applied; retry++) {
      const doc = await ensureMastery(attempt.ownerId, attempt.projectId, conceptId);
      if ((doc.appliedAttemptIds ?? []).some((id) => id.equals(attempt._id))) {
        applied = await appliedDelta(doc, name, attempt);
        break;
      }
      const before = masteryOf(doc, now);
      const startTheta = doc.evidenceCount > 0 ? round(effectiveTheta(doc.theta, doc.lastPracticedAt, now)) : doc.theta;
      const next = applyEvidence(
        { ...doc, theta: startTheta },
        { outcome: attempt.outcome, difficulty: attempt.difficulty, type: attempt.type, cognitiveLevel: attempt.cognitiveLevel, isCorrect: Boolean(attempt.isCorrect) },
      );
      const res = await Mastery.updateOne(
        { _id: doc._id, version: doc.version, appliedAttemptIds: { $ne: attempt._id } },
        {
          $set: {
            theta: next.theta,
            evidenceCount: next.evidenceCount,
            correctCount: next.correctCount,
            scoreSum: next.scoreSum,
            byLevel: next.byLevel,
            byType: next.byType,
            recentOutcomes: next.recentOutcomes,
            lastPracticedAt: now,
          },
          $inc: { version: 1 },
          $push: { appliedAttemptIds: { $each: [attempt._id], $slice: -30 } },
        },
      );
      if (res.modifiedCount !== 1) continue; // lost a race: re-read and try again
      await writeSnapshot(attempt, conceptId, next);
      applied = { conceptId, name, before, after: round(sigmoid(next.theta)), thetaBefore: startTheta, thetaAfter: next.theta };
    }
    if (!applied) throw new Error(`Mastery update for concept ${conceptId.toString()} kept conflicting`);
    deltas.push(applied);
  }
  return deltas;
}

/** Concept ids the learner studied with the Tutor recently: sources cited in their answers → chunk concepts. */
async function recentlyStudiedConcepts(ownerId: Types.ObjectId, projectId: Types.ObjectId, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const messages = await Message.find(
    { ownerId, projectId, role: 'assistant', createdAt: { $gte: since }, 'sources.cited': true },
    { sources: 1 },
  )
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  const chunkIds = messages.flatMap((m) => m.sources.filter((s) => s.cited && s.chunkId).map((s) => s.chunkId!));
  if (chunkIds.length === 0) return new Set();
  const chunks = await Chunk.find({ _id: { $in: chunkIds }, ownerId, projectId }, { conceptIds: 1 }).lean();
  return new Set(chunks.flatMap((c) => c.conceptIds.map((id) => id.toString())));
}

/** Everything the selection engine needs to know about the Project's concepts ("Understand current mastery"). */
export async function loadConceptStates(ownerId: Types.ObjectId, projectId: Types.ObjectId, now = new Date()): Promise<ConceptState[]> {
  const [concepts, masteries, studied] = await Promise.all([
    Concept.find({ ownerId, projectId }, { name: 1, importance: 1, chunkCount: 1, sources: 1 }).sort({ importance: -1 }).limit(200).lean(),
    Mastery.find({ ownerId, projectId }).lean(),
    recentlyStudiedConcepts(ownerId, projectId, now),
  ]);
  const byConcept = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  return concepts.map((c) => {
    const m = byConcept.get(c._id.toString());
    const evidenceCount = m?.evidenceCount ?? 0;
    return {
      conceptId: c._id.toString(),
      name: c.name,
      importance: c.importance ?? 0.5,
      hasEvidence: (c.chunkCount ?? 0) > 0 || c.sources.some((s) => s.pages.length > 0),
      theta: m && evidenceCount > 0 ? round(effectiveTheta(m.theta, m.lastPracticedAt, now)) : 0,
      evidenceCount,
      mastery: m ? masteryOf(m, now) : null,
      lastPracticedAt: m?.lastPracticedAt ?? null,
      recentOutcomes: m?.recentOutcomes ?? [],
      byLevel: m?.byLevel ?? {},
      byType: m?.byType ?? {},
      studiedRecently: studied.has(c._id.toString()),
    };
  });
}

export interface ConceptMasteryDto {
  conceptId: string;
  name: string;
  description: string;
  importance: number;
  mastery: number | null;
  band: ReturnType<typeof bandOf>;
  confidence: ReturnType<typeof confidenceOf>;
  evidenceCount: number;
  correctCount: number;
  accuracy: number | null;
  byLevel: Record<string, { n: number; accuracy: number | null }>;
  weakestLevel: string | null;
  recentOutcomes: number[];
  lastPracticedAt: Date | null;
  sources: Array<{ materialId: string; pages: number[] }>;
}

export async function conceptMastery(ownerId: Types.ObjectId, projectId: Types.ObjectId, now = new Date()): Promise<ConceptMasteryDto[]> {
  const [concepts, masteries] = await Promise.all([
    Concept.find({ ownerId, projectId }, { name: 1, description: 1, importance: 1, sources: 1, chunkCount: 1 }).sort({ importance: -1, chunkCount: -1, name: 1 }).limit(200).lean(),
    Mastery.find({ ownerId, projectId }).lean(),
  ]);
  const byConcept = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  return concepts.map((c) => {
    const m = byConcept.get(c._id.toString());
    const mastery = m ? masteryOf(m, now) : null;
    const evidenceCount = m?.evidenceCount ?? 0;
    const weakest = m && evidenceCount >= 2 ? weakestLevel(m.byLevel) : null;
    return {
      conceptId: c._id.toString(),
      name: c.name,
      description: c.description,
      importance: c.importance,
      mastery,
      band: bandOf(mastery),
      confidence: confidenceOf(evidenceCount),
      evidenceCount,
      correctCount: m?.correctCount ?? 0,
      accuracy: evidenceCount ? round((m?.scoreSum ?? 0) / evidenceCount, 3) : null,
      byLevel: Object.fromEntries(
        COGNITIVE_LEVELS.map((level) => {
          const stat = m?.byLevel?.[level];
          return [level, { n: stat?.n ?? 0, accuracy: stat?.n ? round(stat.sum / stat.n, 3) : null }];
        }),
      ),
      // Only worth pointing out when that level is actually weak (smoothed accuracy below 60 %).
      weakestLevel: weakest && weakest.accuracy < 0.6 ? weakest.level : null,
      recentOutcomes: m?.recentOutcomes ?? [],
      lastPracticedAt: m?.lastPracticedAt ?? null,
      sources: c.sources.map((s) => ({ materialId: s.materialId.toString(), pages: s.pages.slice(0, 12) })),
    };
  });
}

/** GET /projects/:projectId/mastery */
export async function listProjectMastery(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const concepts = await conceptMastery(project.ownerId, project._id);
  return { summary: masterySummary(concepts), concepts };
}

/** Concepts removed with their last material take their mastery with them. */
export async function deleteConceptMastery(ownerId: Types.ObjectId, projectId: Types.ObjectId, conceptIds: Types.ObjectId[]) {
  if (conceptIds.length === 0) return;
  await Promise.all([
    Mastery.deleteMany({ ownerId, projectId, conceptId: { $in: conceptIds } }),
    MasterySnapshot.deleteMany({ ownerId, projectId, conceptId: { $in: conceptIds } }),
  ]);
}
