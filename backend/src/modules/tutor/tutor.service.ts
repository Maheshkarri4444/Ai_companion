import type { Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { toObjectId } from '../../lib/validation';
import { Conversation } from '../../models/conversation.model';
import { Concept } from '../../models/knowledge.model';
import { LearningContext } from '../../models/learningContext.model';
import { Material } from '../../models/material.model';
import { Message } from '../../models/message.model';
import { recordEvent } from '../activity/activity.service';
import { recordEvaluation } from '../evaluation/evaluation.service';
import { forgetLearning, listLearningContext } from '../learning-context/learning-context.service';
import { getOwnedProject } from '../projects/projects.service';
import { toConversationDto, toMessageDto } from './dto';

/** Starter questions built from the Project's own concepts — every one of them is answerable from its materials. */
function starters(concepts: string[], goal: string) {
  const [a, b, c] = concepts;
  if (!a) return ['Summarize the key ideas in my materials', 'What should I learn first?', 'Help me make a revision plan'];
  return [
    `What is ${a}?`,
    b ? `Explain ${b} with an example` : `Give me an example of ${a}`,
    c ? `How does ${a} relate to ${c}?` : `What are the key ideas behind ${a}?`,
    goal ? 'Make me a revision plan for my goal' : 'Help me make a revision plan',
  ];
}

export async function getTutorOverview(ownerId: string, projectId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const scope = { ownerId: project.ownerId, projectId: project._id };
  const [conversations, statusRows, concepts, memoryCount, totals] = await Promise.all([
    Conversation.find(scope).sort({ lastMessageAt: -1 }).limit(30).lean(),
    Material.aggregate<{ _id: string; n: number }>([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Concept.find(scope, { name: 1 }).sort({ importance: -1, chunkCount: -1 }).limit(8).lean(),
    LearningContext.countDocuments({ ownerId: project.ownerId, status: 'active', $or: [{ projectId: project._id }, { scope: 'user' }] }),
    Message.aggregate<{ _id: null; questions: number; answers: number; cited: number }>([
      { $match: { ...scope } },
      {
        $group: {
          _id: null,
          questions: { $sum: { $cond: [{ $eq: ['$role', 'user'] }, 1, 0] } },
          answers: { $sum: { $cond: [{ $eq: ['$role', 'assistant'] }, 1, 0] } },
          cited: { $sum: { $cond: [{ $eq: ['$grounding.status', 'grounded'] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const by = new Map(statusRows.map((r) => [r._id, r.n]));
  const conceptNames = concepts.map((c) => c.name);
  return {
    tutor: { name: 'Zoya' },
    project: { id: project._id.toString(), name: project.name, learningGoal: project.learningGoal },
    knowledge: {
      readyMaterials: by.get('ready') ?? 0,
      pendingMaterials: (by.get('queued') ?? 0) + (by.get('processing') ?? 0),
      failedMaterials: by.get('failed') ?? 0,
      concepts: conceptNames,
    },
    starters: starters(conceptNames, project.learningGoal),
    memoryCount,
    stats: {
      conversations: conversations.length,
      questions: totals[0]?.questions ?? 0,
      groundedAnswers: totals[0]?.cited ?? 0,
    },
    conversations: conversations.map(toConversationDto),
  };
}

export async function listConversations(ownerId: string, projectId: string, options: { before?: Date; limit: number }) {
  const project = await getOwnedProject(ownerId, projectId);
  const filter: Record<string, unknown> = { ownerId: project.ownerId, projectId: project._id };
  if (options.before) filter.lastMessageAt = { $lt: options.before };
  const items = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(options.limit).lean();
  return { items: items.map(toConversationDto), hasMore: items.length === options.limit };
}

async function getOwnedConversation(ownerId: string, projectId: string, conversationId: string) {
  const project = await getOwnedProject(ownerId, projectId);
  const conversation = await Conversation.findOne({
    _id: toObjectId(conversationId),
    ownerId: project.ownerId,
    projectId: project._id,
  }).lean();
  if (!conversation) throw AppError.notFound('Conversation');
  return { project, conversation };
}

export async function getConversation(ownerId: string, projectId: string, conversationId: string, options: { before?: Date; limit: number }) {
  const { conversation } = await getOwnedConversation(ownerId, projectId, conversationId);
  const filter: Record<string, unknown> = { conversationId: conversation._id, ownerId: conversation.ownerId };
  if (options.before) filter.createdAt = { $lt: options.before };
  const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(options.limit).lean();
  messages.reverse();
  return {
    conversation: toConversationDto(conversation),
    messages: messages.map(toMessageDto),
    hasMore: messages.length === options.limit,
  };
}

export async function renameConversation(ownerId: string, projectId: string, conversationId: string, title: string) {
  const { conversation } = await getOwnedConversation(ownerId, projectId, conversationId);
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, ownerId: conversation.ownerId },
    { $set: { title, titleSource: 'user' } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) throw AppError.notFound('Conversation');
  return toConversationDto(updated);
}

export async function deleteConversation(ownerId: string, projectId: string, conversationId: string) {
  const { conversation } = await getOwnedConversation(ownerId, projectId, conversationId);
  await Message.deleteMany({ conversationId: conversation._id, ownerId: conversation.ownerId });
  await Conversation.deleteOne({ _id: conversation._id, ownerId: conversation.ownerId });
}

export async function submitFeedback(
  ownerId: string,
  projectId: string,
  messageId: string,
  input: { rating: 'up' | 'down'; reason?: string; comment?: string },
) {
  const project = await getOwnedProject(ownerId, projectId);
  const message = await Message.findOneAndUpdate(
    { _id: toObjectId(messageId), ownerId: project.ownerId, projectId: project._id, role: 'assistant' },
    { $set: { feedback: { rating: input.rating, reason: input.reason ?? null, comment: input.comment ?? null, at: new Date() } } },
    { returnDocument: 'after' },
  ).lean();
  if (!message) throw AppError.notFound('Message');
  const question = message.replyTo ? await Message.findOne({ _id: message.replyTo, ownerId: project.ownerId }, { content: 1 }).lean() : null;

  await recordEvaluation({
    subjectType: 'tutor_message',
    subjectId: message._id,
    evaluator: 'learner_feedback',
    feature: 'tutor.answer',
    ownerId: project.ownerId,
    projectId: project._id,
    scores: { helpful: input.rating === 'up' ? 1 : 0 },
    verdict: input.rating === 'up' ? 'pass' : 'fail',
    flags: input.reason ? [input.reason] : [],
    rationale: input.comment ?? null,
    inputPreview: question?.content ?? null,
    outputPreview: message.content,
    promptVersion: message.promptVersion,
    model: message.metrics?.model ?? null,
  });
  await recordEvent({
    type: 'tutor.feedback',
    ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    metadata: {
      projectName: project.name,
      messageId: message._id.toString(),
      conversationId: message.conversationId.toString(),
      rating: input.rating,
      reason: input.reason ?? null,
    },
  });
  return toMessageDto(message);
}

export async function listProjectMemory(ownerId: string, projectId: string) {
  await getOwnedProject(ownerId, projectId);
  return listLearningContext(ownerId, projectId);
}

export async function forgetProjectMemory(ownerId: string, projectId: string, itemId: string) {
  await getOwnedProject(ownerId, projectId);
  await forgetLearning(ownerId, projectId, itemId);
}

/** Everything the Tutor stored for a Project (used by the cascade). */
export async function deleteProjectTutorData(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  await Promise.all([Message.deleteMany({ ownerId, projectId }), Conversation.deleteMany({ ownerId, projectId })]);
}

/** Reconciler: answers left "streaming" by a crashed process are closed as interrupted. */
export async function closeAbandonedAnswers(olderThanMs: number) {
  const res = await Message.updateMany(
    { role: 'assistant', status: 'streaming', updatedAt: { $lt: new Date(Date.now() - olderThanMs) } },
    { $set: { status: 'error', error: { code: 'INTERRUPTED', message: 'This answer was interrupted. Ask again to retry.' } } },
  );
  return res.modifiedCount;
}
