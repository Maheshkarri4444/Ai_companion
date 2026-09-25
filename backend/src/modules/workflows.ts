import { config } from '../config/env';
import { enqueueJob } from '../jobs/queue';
import { sha256 } from '../lib/text';
import { Conversation } from '../models/conversation.model';
import { Material } from '../models/material.model';
import { onActivity } from './activity/activity.service';
import { enqueueJudge } from './evaluation/evaluation.jobs';
import { enqueueMaterialProcessing } from './knowledge/knowledge.service';
import { summaryNeeded } from './tutor/tutor.jobs';

/**
 * Event → workflow wiring (PRD §12–13, docs/ARCHITECTURE.md §11). Subscribers only enqueue idempotent jobs
 * (keys derived from the event subject), so replayed or duplicated events never create duplicate work; the
 * reconciler repairs anything lost if enqueueing itself fails.
 */

/** Deterministic sampling: the same message always gets the same decision, across retries and processes. */
export function sampled(id: string, rate: number) {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return parseInt(sha256(id).slice(0, 8), 16) / 0xffffffff < rate;
}

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
}
