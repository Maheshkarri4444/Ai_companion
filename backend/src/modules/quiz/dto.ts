import type { IAttempt, IQuestion, IQuizSession, QuizSummary } from '../../models/quiz.model';

/*
 * Explicit DTOs. The answer key (correct option, explanation, rubric, option rationales, sources) is only included
 * once the question has been answered or the session has ended — never while the learner can still answer.
 */

const id = (value: { toString(): string } | null | undefined) => (value ? value.toString() : null);

export function toSummaryDto(summary: QuizSummary | null) {
  if (!summary) return null;
  return {
    ...summary,
    byConcept: summary.byConcept.map((c) => ({ ...c, conceptId: c.conceptId.toString() })),
    review: summary.review.map((r) => ({ ...r, materialId: r.materialId.toString() })),
  };
}
export type SummaryDto = NonNullable<ReturnType<typeof toSummaryDto>>;

export function toSessionDto(s: IQuizSession) {
  const graded = s.gradedCount ?? 0;
  return {
    id: s._id.toString(),
    projectId: s.projectId.toString(),
    status: s.status,
    mode: s.mode,
    questionTypes: s.questionTypes,
    focusConceptIds: (s.focusConceptIds ?? []).map((c) => c.toString()),
    targetCount: s.targetCount,
    servedCount: s.servedCount,
    answeredCount: s.answeredCount,
    gradedCount: graded,
    pendingCount: Math.max(0, s.answeredCount - graded),
    correctCount: s.correctCount,
    accuracy: graded ? Math.round((s.correctCount / graded) * 1000) / 1000 : null,
    avgScore: graded ? Math.round((s.scoreSum / graded) * 1000) / 1000 : null,
    currentQuestionId: id(s.currentQuestionId),
    summary: toSummaryDto(s.summary),
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    lastActivityAt: s.lastActivityAt,
  };
}
export type SessionDto = ReturnType<typeof toSessionDto>;

export function toAttemptDto(a: IAttempt) {
  return {
    id: a._id.toString(),
    questionId: a.questionId.toString(),
    response: { optionId: a.response?.optionId ?? null, text: a.response?.text ?? null, skipped: Boolean(a.response?.skipped) },
    outcome: a.outcome,
    isCorrect: a.isCorrect,
    feedback: a.feedback,
    grading: { status: a.grading.status, method: a.grading.method, flags: a.grading.flags ?? [] },
    masteryDelta: (a.masteryDelta ?? []).map((d) => ({ conceptId: d.conceptId.toString(), name: d.name, before: d.before, after: d.after })),
    timeMs: a.timeMs,
    reported: Boolean(a.report),
    createdAt: a.createdAt,
  };
}
export type AttemptDto = ReturnType<typeof toAttemptDto>;

export function toQuestionDto(q: IQuestion, attempt: IAttempt | null, options: { sessionEnded?: boolean } = {}) {
  const revealed = Boolean(attempt) || Boolean(options.sessionEnded);
  return {
    id: q._id.toString(),
    sessionId: q.sessionId.toString(),
    position: q.position,
    status: q.status,
    type: q.type,
    difficulty: q.difficulty,
    cognitiveLevel: q.cognitiveLevel,
    conceptIds: q.conceptIds.map((c) => c.toString()),
    conceptNames: q.conceptNames,
    stem: q.stem,
    options: q.options.map((o) => (revealed ? { id: o.id, text: o.text, rationale: o.rationale } : { id: o.id, text: o.text })),
    /** "Why this question?" — the adaptive engine's reasoning is shown to the learner. */
    selection: {
      reason: q.selection?.reason ?? null,
      predictedP: q.selection?.predictedP ?? null,
      targetP: q.selection?.targetP ?? null,
      mastery: q.selection?.mastery ?? null,
      evidence: q.selection?.evidence ?? 0,
      explored: Boolean(q.selection?.explored),
    },
    revealed,
    correctOptionId: revealed ? q.correctOptionId : null,
    explanation: revealed ? q.explanation : null,
    rubric: revealed && q.rubric ? { keyPoints: q.rubric.keyPoints, sampleAnswer: q.rubric.sampleAnswer } : null,
    sources: revealed
      ? q.sources.map((s) => ({
          ref: s.ref,
          materialId: s.materialId.toString(),
          materialTitle: s.materialTitle,
          pageStart: s.pageStart,
          pageEnd: s.pageEnd,
          sectionTitle: s.sectionTitle ?? null,
          snippet: s.snippet,
          cited: Boolean(s.cited),
        }))
      : [],
    attempt: attempt ? toAttemptDto(attempt) : null,
    servedAt: q.servedAt,
  };
}
export type QuestionDto = ReturnType<typeof toQuestionDto>;
