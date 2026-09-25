import { z } from 'zod';
import { ai } from '../../ai';
import { MEMORY_PROMPT, SUMMARY_PROMPT } from '../../ai/prompts/tutor';
import { registerJobHandler } from '../../jobs/registry';
import { escapePromptData, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { Conversation } from '../../models/conversation.model';
import { LEARNING_KINDS } from '../../models/learningContext.model';
import { Message } from '../../models/message.model';
import { Project } from '../../models/project.model';
import { listLearningContext, rememberLearning } from '../learning-context/learning-context.service';
import { stripCitations } from './citations';

/** The prompt window replays the last 8 messages; older turns survive only through the rolling summary. */
export const SUMMARY_MIN_MESSAGES = 8;
export const SUMMARY_MIN_NEW = 6;

export function summaryNeeded(conversation: { messageCount: number; summary: { messageCount: number } | null; titleSource: string }) {
  const covered = conversation.summary?.messageCount ?? 0;
  return {
    title: conversation.titleSource === 'auto' && conversation.messageCount >= 2,
    summary: conversation.messageCount >= SUMMARY_MIN_MESSAGES && conversation.messageCount - covered >= SUMMARY_MIN_NEW,
  };
}

// Size limits are applied by truncation (not validation) so they never trigger a repair call.
const SummaryOutput = z.object({ summary: z.string(), title: z.string() });

const MemoryOutput = z.object({
  items: z.array(
    z.object({
      kind: z.enum(LEARNING_KINDS.filter((k) => k !== 'mistake_pattern' && k !== 'note') as [string, ...string[]]),
      content: z.string().min(4),
      salience: z.number().min(0).max(1),
    }),
  ),
});

const line = (role: string, content: string, max: number) =>
  `${role === 'user' ? 'Learner' : 'Tutor'}: ${escapePromptData(truncate(stripCitations(content).replace(/\s+/g, ' '), max))}`;

export function registerTutorJobs() {
  /** `tutor.summarize`: rolling summary (continuity without replaying history) + an AI title for new threads. */
  registerJobHandler('tutor.summarize', async ({ job, signal }) => {
    const { conversationId } = job.payload as { conversationId: string };
    const conversation = await Conversation.findById(toObjectId(conversationId)).lean();
    if (!conversation) return { skipped: 'conversation-deleted' };
    const messages = await Message.find({ conversationId: conversation._id, status: { $in: ['complete', 'stopped'] } })
      .sort({ createdAt: 1 })
      .lean();
    const need = summaryNeeded({ ...conversation, messageCount: messages.length });
    if (!need.title && !need.summary) return { skipped: 'up-to-date' };

    const covered = conversation.summary?.messageCount ?? 0;
    const fresh = need.summary ? messages.slice(covered) : messages.slice(0, 4);
    let transcript = fresh.map((m) => line(m.role, m.content, 700)).join('\n');
    if (transcript.length > 12_000) transcript = transcript.slice(-12_000);

    const { data } = await ai().structured({
      feature: need.summary ? 'tutor.summarize' : 'tutor.title',
      tier: 'light',
      promptVersion: SUMMARY_PROMPT.version,
      system: SUMMARY_PROMPT.system,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: SUMMARY_PROMPT.build({
                previous: need.summary ? (conversation.summary?.text ?? null) : null,
                messages: transcript,
                needTitle: need.title,
              }),
            },
          ],
        },
      ],
      schema: SummaryOutput,
      meta: { ownerId: conversation.ownerId.toString(), projectId: conversation.projectId.toString(), conversationId, jobId: job._id.toString() },
      signal,
      timeoutMs: 30_000,
      inputPreview: `Summarize "${conversation.title}"`,
    });

    const result: Record<string, unknown> = {};
    if (need.summary && data.summary.trim()) {
      await Conversation.updateOne(
        { _id: conversation._id },
        { $set: { summary: { text: truncate(data.summary.trim(), 2000), messageCount: messages.length, updatedAt: new Date() } } },
      );
      result.summarized = messages.length;
    }
    const title = truncate(data.title.replace(/["“”]/g, '').replace(/[.!?\s]+$/, '').trim(), 80);
    if (need.title && title.length >= 3) {
      // Never overwrite a title the learner chose in the meantime.
      await Conversation.updateOne({ _id: conversation._id, titleSource: 'auto' }, { $set: { title: truncate(title, 80), titleSource: 'ai' } });
      result.title = title;
    }
    return result;
  });

  /** `tutor.memory`: extracts durable learner context from one exchange (usually nothing). */
  registerJobHandler('tutor.memory', async ({ job, signal }) => {
    const { messageId } = job.payload as { messageId: string };
    const answer = await Message.findById(toObjectId(messageId)).lean();
    if (!answer || answer.role !== 'assistant' || answer.status === 'error') return { skipped: 'not-applicable' };
    const question = await Message.findOne({ _id: answer.replyTo, ownerId: answer.ownerId }).lean();
    if (!question || question.content.trim().length < 12) return { skipped: 'too-short' };
    const project = await Project.findOne({ _id: answer.projectId, ownerId: answer.ownerId }, { learningGoal: 1 }).lean();
    if (!project) return { skipped: 'project-deleted' };

    const earlier = await Message.find({
      conversationId: answer.conversationId,
      createdAt: { $lt: question.createdAt },
      status: 'complete',
    })
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();
    const exchange = [...earlier.reverse(), question, answer].map((m) => line(m.role, m.content, m === answer ? 900 : 600)).join('\n');
    const remembered = (await listLearningContext(answer.ownerId.toString(), answer.projectId.toString()))
      .slice(0, 20)
      .map((i) => `(${i.kind}) ${i.content}`);

    const { data } = await ai().structured({
      feature: 'tutor.memory',
      tier: 'light',
      promptVersion: MEMORY_PROMPT.version,
      system: MEMORY_PROMPT.system,
      contents: [{ role: 'user', parts: [{ text: MEMORY_PROMPT.build({ goal: truncate(project.learningGoal, 300), remembered, exchange }) }] }],
      schema: MemoryOutput,
      meta: {
        ownerId: answer.ownerId.toString(),
        projectId: answer.projectId.toString(),
        conversationId: answer.conversationId.toString(),
        messageId,
        jobId: job._id.toString(),
      },
      signal,
      timeoutMs: 30_000,
      inputPreview: `Memory: ${truncate(question.content, 200)}`,
    });
    if (data.items.length === 0) return { created: 0, reinforced: 0 };
    return rememberLearning({
      ownerId: answer.ownerId,
      projectId: answer.projectId,
      items: data.items.slice(0, 4).map((i) => ({ kind: i.kind as (typeof LEARNING_KINDS)[number], content: truncate(i.content, 240), salience: i.salience })),
      source: { type: 'tutor', refId: messageId },
      meta: { ownerId: answer.ownerId.toString(), projectId: answer.projectId.toString(), jobId: job._id.toString() },
      signal,
    });
  });
}
