import type { Types } from 'mongoose';
import {
  Attempt,
  COGNITIVE_LEVELS,
  Question,
  QUESTION_TYPES,
  QuizSession,
  type ConceptResult,
  type IAttempt,
  type IQuestion,
  type IQuizSession,
  type QuizSummary,
  type ReviewSuggestion,
} from '../../models/quiz.model';

/*
 * Session aggregates. Counters are recomputed from the attempts (never incremented), so a retried request, a
 * background grading or the reconciler can refresh them any number of times without double counting.
 */

const round = (x: number) => Math.round(x * 1000) / 1000;
const mean = (values: number[]) => (values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null);
const REVIEW_BELOW = 0.7;

export async function refreshSessionCounters(sessionId: Types.ObjectId): Promise<IQuizSession | null> {
  const attempts = await Attempt.find({ sessionId }, { outcome: 1, isCorrect: 1, 'grading.status': 1 }).lean();
  const graded = attempts.filter((a) => a.grading.status === 'graded' && a.outcome !== null);
  return QuizSession.findOneAndUpdate(
    { _id: sessionId },
    {
      $set: {
        answeredCount: attempts.length,
        gradedCount: graded.length,
        correctCount: graded.filter((a) => a.isCorrect).length,
        scoreSum: round(graded.reduce((n, a) => n + (a.outcome ?? 0), 0)),
      },
    },
    { returnDocument: 'after' },
  ).lean();
}

/** Results of one session: per concept (with mastery before → after), per level and type, and what to review. */
export function buildSummary(attempts: IAttempt[], questions: IQuestion[]): QuizSummary {
  const questionById = new Map(questions.map((q) => [q._id.toString(), q]));
  const ordered = [...attempts].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const graded = ordered.filter((a) => a.grading.status === 'graded' && a.outcome !== null);

  const concepts = new Map<string, { conceptId: Types.ObjectId; name: string; scores: number[]; answered: number; before: number | null | undefined; after: number | null }>();
  for (const attempt of ordered) {
    const question = questionById.get(attempt.questionId.toString());
    const conceptId = attempt.conceptIds[0];
    if (!conceptId) continue;
    const key = conceptId.toString();
    const entry = concepts.get(key) ?? { conceptId, name: question?.conceptNames[0] ?? 'Concept', scores: [], answered: 0, before: undefined, after: null };
    entry.answered += 1;
    if (attempt.grading.status === 'graded' && attempt.outcome !== null) entry.scores.push(attempt.outcome);
    const delta = (attempt.masteryDelta ?? []).find((d) => d.conceptId.toString() === key);
    if (delta) {
      if (entry.before === undefined) entry.before = delta.before;
      entry.after = delta.after;
    }
    concepts.set(key, entry);
  }
  const byConcept: ConceptResult[] = [...concepts.values()].map((c) => ({
    conceptId: c.conceptId,
    name: c.name,
    answered: c.answered,
    avgScore: mean(c.scores),
    masteryBefore: c.before === undefined ? null : c.before,
    masteryAfter: c.after,
  }));

  const byLevel = Object.fromEntries(
    COGNITIVE_LEVELS.map((level) => {
      const scores = graded.filter((a) => a.cognitiveLevel === level).map((a) => a.outcome as number);
      return [level, { n: scores.length, avgScore: mean(scores) }];
    }),
  ) as QuizSummary['byLevel'];
  const byType = Object.fromEntries(
    QUESTION_TYPES.map((type) => {
      const scores = graded.filter((a) => a.type === type).map((a) => a.outcome as number);
      return [type, { n: scores.length, avgScore: mean(scores) }];
    }),
  ) as QuizSummary['byType'];

  // "Return to the original material": the pages behind every question that went wrong.
  const review = new Map<string, ReviewSuggestion>();
  for (const attempt of graded.filter((a) => (a.outcome as number) < REVIEW_BELOW)) {
    const question = questionById.get(attempt.questionId.toString());
    if (!question) continue;
    const cited = question.sources.filter((s) => s.cited);
    for (const source of cited.length ? cited : question.sources.slice(0, 1)) {
      const key = `${source.materialId.toString()}:${question.conceptNames[0] ?? ''}`;
      const entry = review.get(key) ?? { materialId: source.materialId, materialTitle: source.materialTitle, pages: [], conceptName: question.conceptNames[0] ?? '' };
      for (let p = source.pageStart; p <= source.pageEnd; p++) if (!entry.pages.includes(p)) entry.pages.push(p);
      entry.pages.sort((a, b) => a - b);
      review.set(key, entry);
    }
  }

  const correct = graded.filter((a) => a.isCorrect).length;
  return {
    answered: ordered.length,
    graded: graded.length,
    pending: ordered.filter((a) => a.grading.status === 'pending').length,
    correct,
    accuracy: graded.length ? round(correct / graded.length) : null,
    avgScore: mean(graded.map((a) => a.outcome as number)),
    timeMs: ordered.reduce((n, a) => n + (a.timeMs ?? 0), 0),
    byConcept,
    byLevel,
    byType,
    strengths: byConcept.filter((c) => c.avgScore !== null && c.avgScore >= 0.8).map((c) => c.name),
    needsWork: byConcept.filter((c) => c.avgScore !== null && c.avgScore < 0.5).map((c) => c.name),
    review: [...review.values()].slice(0, 6),
  };
}

export async function computeSessionSummary(sessionId: Types.ObjectId): Promise<QuizSummary> {
  const [attempts, questions] = await Promise.all([
    Attempt.find({ sessionId }).lean(),
    Question.find({ sessionId, status: { $in: ['served', 'answered'] } }).lean(),
  ]);
  return buildSummary(attempts, questions);
}
