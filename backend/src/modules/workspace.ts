import type { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { Concept } from '../models/knowledge.model';
import { Project } from '../models/project.model';
import { Space } from '../models/space.model';

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

export function projectNextStep(
  project: { _id: Types.ObjectId; name: string },
  byStatus: { queued: number; processing: number; ready: number; failed: number },
  tutor?: TutorState,
): NextStep {
  const ref = { projectId: project._id.toString(), projectName: project.name };
  const total = byStatus.queued + byStatus.processing + byStatus.ready + byStatus.failed;
  if (total === 0) return { kind: 'upload_material', ...ref };
  const pending = byStatus.queued + byStatus.processing;
  if (byStatus.ready === 0 && pending > 0) return { kind: 'await_processing', ...ref, pendingCount: pending };
  if (byStatus.ready === 0 && byStatus.failed > 0) return { kind: 'retry_failed', ...ref, failedCount: byStatus.failed };
  if (tutor?.lastConversation) {
    return { kind: 'continue_tutor', ...ref, conversationId: tutor.lastConversation.id, conversationTitle: tutor.lastConversation.title };
  }
  if (byStatus.ready > 0 && tutor) return { kind: 'ask_tutor', ...ref, concept: tutor.topConcept };
  if (pending > 0) return { kind: 'await_processing', ...ref, pendingCount: pending };
  return { kind: 'continue_project', ...ref };
}
