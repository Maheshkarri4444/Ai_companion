import { truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { Attempt, Question, QuizSession } from '../../models/quiz.model';
import { ago, registerContextProvider, type ContextProvider } from '../learning-context/providers';
import { conceptMastery } from '../mastery/mastery.service';

/*
 * Assessment context for every AI feature that composes context (docs/ARCHITECTURE.md §20): the Tutor adapts its
 * explanations to what the learner has (not) mastered, and the quiz generator targets known weak points — both
 * without code changes, through the provider registry.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;
const BAND_LABEL = { needs_attention: 'needs attention', developing: 'developing', strong: 'strong', not_assessed: 'not assessed' } as const;

const mastery: ContextProvider = {
  id: 'mastery',
  priority: 95,
  async load({ ownerId, projectId }) {
    const concepts = await conceptMastery(toObjectId(ownerId), toObjectId(projectId));
    const assessed = concepts.filter((c) => c.mastery !== null).sort((a, b) => (a.mastery as number) - (b.mastery as number));
    if (assessed.length === 0) return null;
    const describe = (c: (typeof concepts)[number]) =>
      `${c.name}: ${pct(c.mastery as number)} (${BAND_LABEL[c.band]}; ${c.evidenceCount} answer${c.evidenceCount === 1 ? '' : 's'}${c.weakestLevel ? `; ${c.weakestLevel} questions are hardest` : ''})`;
    const lines = [
      ...assessed.filter((c) => (c.mastery as number) < 0.8).slice(0, 4).map(describe),
      ...assessed.filter((c) => (c.mastery as number) >= 0.8).slice(-2).reverse().map(describe),
    ];
    const unassessed = concepts.filter((c) => c.mastery === null).slice(0, 5).map((c) => c.name);
    if (unassessed.length) lines.push(`Not assessed yet: ${unassessed.join(', ')}`);
    return {
      id: 'mastery',
      title: 'Concept mastery (estimated from quiz answers)',
      lines,
      data: { concepts: assessed.map((c) => ({ name: c.name, mastery: c.mastery, band: c.band, answers: c.evidenceCount, weakestLevel: c.weakestLevel })) },
    };
  },
};

const assessmentHistory: ContextProvider = {
  id: 'assessment_history',
  priority: 70,
  async load({ ownerId, projectId }) {
    const owner = toObjectId(ownerId);
    const project = toObjectId(projectId);
    const [last, misses] = await Promise.all([
      QuizSession.findOne({ ownerId: owner, projectId: project, status: 'completed' }).sort({ completedAt: -1 }).lean(),
      Attempt.find({ ownerId: owner, projectId: project, 'grading.status': 'graded', outcome: { $lt: 0.5 } })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean(),
    ]);
    if (!last && misses.length === 0) return null;
    const lines: string[] = [];
    if (last?.summary && last.completedAt) {
      const s = last.summary;
      lines.push(
        `Last quiz (${ago(last.completedAt)}): ${s.correct}/${s.graded} correct${s.needsWork.length ? `; needs work: ${s.needsWork.join(', ')}` : ''}${s.strengths.length ? `; strong: ${s.strengths.join(', ')}` : ''}`,
      );
    }
    const questions = new Map((await Question.find({ _id: { $in: misses.map((m) => m.questionId) } }, { stem: 1, conceptNames: 1 }).lean()).map((q) => [q._id.toString(), q]));
    for (const miss of misses) {
      const q = questions.get(miss.questionId.toString());
      if (!q) continue;
      const missing = miss.feedback?.missing?.[0];
      lines.push(`Missed (${q.conceptNames[0] ?? 'concept'}, ${miss.cognitiveLevel}, ${ago(miss.createdAt)}): "${truncate(q.stem, 140)}"${missing ? ` — missing: ${truncate(missing, 120)}` : ''}`);
    }
    return lines.length ? { id: 'assessment_history', title: 'Recent assessment results', lines } : null;
  },
};

export function registerQuizContextProviders() {
  registerContextProvider(mastery);
  registerContextProvider(assessmentHistory);
}
