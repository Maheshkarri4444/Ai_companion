import type { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { Concept } from '../models/knowledge.model';
import { Mastery } from '../models/mastery.model';
import { Project } from '../models/project.model';
import { Attempt, QuizSession } from '../models/quiz.model';
import { Space } from '../models/space.model';
import { masteryOf, masterySummary, type MasterySummary } from './mastery/estimator';

/** Bumps `lastActivityAt` so "recent" and "continue learning" views reflect real usage. */
export async function touchActivity(ids: { spaceId?: Types.ObjectId; projectId?: Types.ObjectId }): Promise<void> {
  const now = new Date();
  await Promise.all([
    ids.spaceId ? Space.updateOne({ _id: ids.spaceId }, { $set: { lastActivityAt: now } }) : null,
    ids.projectId ? Project.updateOne({ _id: ids.projectId }, { $set: { lastActivityAt: now } }) : null,
  ]);
}

/** Rule-based guidance until the recommendation engine exists (docs/ARCHITECTURE.md §32 D10). */
export type NextStep =
  | { kind: 'create_space' }
  | { kind: 'create_project'; spaceId: string; spaceName: string }
  | { kind: 'upload_material'; projectId: string; projectName: string }
  | { kind: 'await_processing'; projectId: string; projectName: string; pendingCount: number }
  | { kind: 'retry_failed'; projectId: string; projectName: string; failedCount: number }
  | { kind: 'ask_tutor'; projectId: string; projectName: string; concept: string | null }
  | { kind: 'continue_tutor'; projectId: string; projectName: string; conversationId: string; conversationTitle: string }
  | { kind: 'resume_quiz'; projectId: string; projectName: string; sessionId: string; answered: number; target: number }
  | {
      kind: 'start_quiz';
      projectId: string;
      projectName: string;
      reason: 'first_quiz' | 'practice_weak';
      conceptId: string | null;
      conceptName: string | null;
      mastery: number | null;
    }
  | { kind: 'continue_project'; projectId: string; projectName: string };

export interface TutorState {
  lastConversation: { id: string; title: string } | null;
  topConcept: string | null;
}

/** What the Tutor knows about a Project, for next-step guidance. */
export async function tutorStateFor(project: { _id: Types.ObjectId; ownerId: Types.ObjectId }): Promise<TutorState> {
  const [conversation, concept] = await Promise.all([
    Conversation.findOne({ ownerId: project.ownerId, projectId: project._id }, { title: 1 }).sort({ lastMessageAt: -1 }).lean(),
    Concept.findOne({ ownerId: project.ownerId, projectId: project._id }, { name: 1 }).sort({ importance: -1, chunkCount: -1 }).lean(),
  ]);
  return {
    lastConversation: conversation ? { id: conversation._id.toString(), title: conversation.title } : null,
    topConcept: concept?.name ?? null,
  };
}

export interface QuizState {
  active: { id: string; answered: number; target: number } | null;
  completedCount: number;
  questionsAnswered: number;
  correct: number;
  mastery: MasterySummary;
  /** Lowest assessed concept (effective mastery), for "practise X next". */
  weakest: { conceptId: string; name: string; mastery: number } | null;
}

/** Assessment state of a Project: quiz in progress, history, and concept mastery. */
export async function quizStateFor(project: { _id: Types.ObjectId; ownerId: Types.ObjectId }): Promise<QuizState> {
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const [active, completedCount, totals, masteries, concepts] = await Promise.all([
    QuizSession.findOne({ ...scope, status: 'active' }, { answeredCount: 1, targetCount: 1 }).lean(),
    QuizSession.countDocuments({ ...scope, status: 'completed' }),
    Attempt.aggregate<{ _id: null; n: number; correct: number }>([
      { $match: { ...scope, 'grading.status': 'graded' } },
      { $group: { _id: null, n: { $sum: 1 }, correct: { $sum: { $cond: ['$isCorrect', 1, 0] } } } },
    ]),
    Mastery.find(scope, { conceptId: 1, theta: 1, evidenceCount: 1, lastPracticedAt: 1 }).lean(),
    Concept.find(scope, { name: 1, importance: 1 }).lean(),
  ]);
  const now = new Date();
  const byConcept = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  const items = concepts.map((c) => ({ id: c._id.toString(), name: c.name, importance: c.importance ?? 0.5, mastery: masteryOf(byConcept.get(c._id.toString()), now) }));
  const weakest = items.filter((i) => i.mastery !== null).sort((a, b) => (a.mastery as number) - (b.mastery as number))[0];
  return {
    active: active ? { id: active._id.toString(), answered: active.answeredCount, target: active.targetCount } : null,
    completedCount,
    questionsAnswered: totals[0]?.n ?? 0,
    correct: totals[0]?.correct ?? 0,
    mastery: masterySummary(items),
    weakest: weakest ? { conceptId: weakest.id, name: weakest.name, mastery: weakest.mastery as number } : null,
  };
}

export function projectNextStep(
  project: { _id: Types.ObjectId; name: string },
  byStatus: { queued: number; processing: number; ready: number; failed: number },
  tutor?: TutorState,
  quiz?: QuizState,
): NextStep {
  const ref = { projectId: project._id.toString(), projectName: project.name };
  const total = byStatus.queued + byStatus.processing + byStatus.ready + byStatus.failed;
  if (total === 0) return { kind: 'upload_material', ...ref };
  const pending = byStatus.queued + byStatus.processing;
  if (byStatus.ready === 0 && pending > 0) return { kind: 'await_processing', ...ref, pendingCount: pending };
  if (byStatus.ready === 0 && byStatus.failed > 0) return { kind: 'retry_failed', ...ref, failedCount: byStatus.failed };
  if (quiz?.active) return { kind: 'resume_quiz', ...ref, sessionId: quiz.active.id, answered: quiz.active.answered, target: quiz.active.target };
  if (byStatus.ready > 0 && quiz) {
    // Learn → test: after studying with the Tutor, check understanding; afterwards, practise the weakest concept.
    if (tutor?.lastConversation && quiz.completedCount === 0) {
      return { kind: 'start_quiz', ...ref, reason: 'first_quiz', conceptId: null, conceptName: null, mastery: null };
    }
    if (quiz.weakest && quiz.weakest.mastery < 0.5) {
      return { kind: 'start_quiz', ...ref, reason: 'practice_weak', conceptId: quiz.weakest.conceptId, conceptName: quiz.weakest.name, mastery: quiz.weakest.mastery };
    }
  }
  if (tutor?.lastConversation) {
    return { kind: 'continue_tutor', ...ref, conversationId: tutor.lastConversation.id, conversationTitle: tutor.lastConversation.title };
  }
  if (byStatus.ready > 0 && tutor) return { kind: 'ask_tutor', ...ref, concept: tutor.topConcept };
  if (pending > 0) return { kind: 'await_processing', ...ref, pendingCount: pending };
  return { kind: 'continue_project', ...ref };
}
