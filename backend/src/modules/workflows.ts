import { config } from '../config/env';
import { enqueueJob } from '../jobs/queue';
import { Conversation } from '../models/conversation.model';
import { Material } from '../models/material.model';
import { onActivity } from './activity/activity.service';
import { enqueueJudge } from './evaluation/evaluation.jobs';
import { sampled } from './evaluation/evaluation.service';
import { enqueueMaterialProcessing } from './knowledge/knowledge.service';
import { onQuestionAnswered, onQuizCompleted } from './quiz/learning';
import { enqueueRecommendationRefresh } from './recommendations/recommendations.service';
import { summaryNeeded } from './tutor/tutor.jobs';

/**
 * Event → workflow wiring (PRD §12–13, docs/ARCHITECTURE.md §11). Subscribers only enqueue idempotent jobs
 * (keys derived from the event subject), so replayed or duplicated events never create duplicate work; the
 * reconciler repairs anything lost if enqueueing itself fails.
 */

export function registerWorkflows() {
  // Material workflow: Upload → Process → Extract concepts → Searchable knowledge → Update Project
  onActivity('material.uploaded', async (event) => {
    if (!event.materialId) return;
    const material = await Material.findById(event.materialId, { ownerId: 1, projectId: 1, processing: 1, status: 1 }).lean();
    if (material?.status === 'queued') await enqueueMaterialProcessing(material);
  });

  // Tutor workflow: Answer → remember learner context → keep the conversation summary → evaluate quality
  onActivity('tutor.answered', async (event) => {
    const meta = event.metadata as {
      messageId?: string;
      conversationId?: string;
      status?: string;
      grounding?: string | null;
      rulesVerdict?: string | null;
    };
    if (!meta.messageId || !meta.conversationId) return;
    const scope = { ownerId: event.ownerId, projectId: event.projectId };

    await enqueueJob({
      type: 'tutor.memory',
      idempotencyKey: `tutor.memory:${meta.messageId}`,
      payload: { messageId: meta.messageId },
      ...scope,
      maxAttempts: 2,
      priority: -1,
    });

    const conversation = await Conversation.findById(meta.conversationId, { messageCount: 1, summary: 1, titleSource: 1 }).lean();
    if (conversation) {
      const need = summaryNeeded(conversation);
      if (need.title || need.summary) {
        await enqueueJob({
          type: 'tutor.summarize',
          idempotencyKey: `tutor.summarize:${meta.conversationId}:${conversation.messageCount}`,
          payload: { conversationId: meta.conversationId },
          ...scope,
          maxAttempts: 3,
        });
      }
    }

    const judgeable = meta.status === 'complete' && meta.grounding !== 'conversational';
    if (judgeable && (meta.rulesVerdict === 'fail' || sampled(meta.messageId, config.TUTOR_JUDGE_SAMPLE_RATE))) {
      await enqueueJudge({ subjectType: 'tutor_message', subjectId: meta.messageId, ownerId: event.ownerId.toString(), projectId: event.projectId?.toString() });
    }
  });

  // Negative feedback always gets a judge verdict (idempotent: at most one per message).
  onActivity('tutor.feedback', async (event) => {
    const meta = event.metadata as { messageId?: string; rating?: string };
    if (meta.rating !== 'down' || !meta.messageId) return;
    await enqueueJudge({
      subjectType: 'tutor_message',
      subjectId: meta.messageId,
      ownerId: event.ownerId.toString(),
      projectId: event.projectId?.toString(),
      priority: 0,
    });
  });

  // Repeated-mistake workflow: Repeated mistake → identify pattern → update learning context → targeted recommendation
  // (the `learning.repeated_mistake` job enqueues the recommendation refresh once a pattern is stored).
  onActivity('quiz.question_answered', onQuestionAnswered);

  // Learning workflow: Quiz completed → evaluate → (mastery already updated) → detect weakness → learning context
  onActivity('quiz.completed', onQuizCompleted);

  // … → generate insight → recommend the next action. Also refreshed when new knowledge arrives.
  // (Idempotent per event; a refresh is a no-op when the learner's state did not change.)
  onActivity('quiz.completed', async (event) => {
    if (!event.projectId) return;
    const sessionId = String((event.metadata as { sessionId?: string }).sessionId ?? event._id);
    await enqueueRecommendationRefresh({ ownerId: event.ownerId, projectId: event.projectId, reason: `quiz:${sessionId}` });
  });
  onActivity('material.processed', async (event) => {
    if (!event.projectId) return;
    await enqueueRecommendationRefresh({ ownerId: event.ownerId, projectId: event.projectId, reason: `material:${event.materialId?.toString() ?? event._id.toString()}` });
  });
}
