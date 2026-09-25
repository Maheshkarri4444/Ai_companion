import { Router, type Response } from 'express';
import { handler } from '../../lib/handler';
import { logger } from '../../lib/logger';
import { tutorRateLimit } from '../../middleware/rateLimits';
import { executeTurn, prepareTurn, replayTurn, stopActiveTurn, trackActiveTurn, type TutorEvent } from './orchestrator';
import {
  conversationParams,
  conversationsQuery,
  feedbackBody,
  memoryParams,
  messageParams,
  messagesQuery,
  projectParams,
  renameConversationBody,
  sendMessageBody,
} from './tutor.schemas';
import {
  deleteConversation,
  forgetProjectMemory,
  getConversation,
  getTutorOverview,
  listConversations,
  listProjectMemory,
  renameConversation,
  submitFeedback,
} from './tutor.service';

// Mounted under /api/projects/:projectId/tutor (authentication applied by the parent router).
export const tutorRouter = Router({ mergeParams: true });

tutorRouter.get('/', handler({ params: projectParams }, ({ auth, params }) => getTutorOverview(auth.userId, params.projectId)));

tutorRouter.get(
  '/conversations',
  handler({ params: projectParams, query: conversationsQuery }, ({ auth, params, query }) =>
    listConversations(auth.userId, params.projectId, query),
  ),
);

tutorRouter.get(
  '/conversations/:conversationId',
  handler({ params: conversationParams, query: messagesQuery }, ({ auth, params, query }) =>
    getConversation(auth.userId, params.projectId, params.conversationId, query),
  ),
);

tutorRouter.patch(
  '/conversations/:conversationId',
  handler({ params: conversationParams, body: renameConversationBody }, async ({ auth, params, body }) => ({
    conversation: await renameConversation(auth.userId, params.projectId, params.conversationId, body.title),
  })),
);

tutorRouter.delete(
  '/conversations/:conversationId',
  handler({ params: conversationParams }, async ({ auth, params }) => {
    await deleteConversation(auth.userId, params.projectId, params.conversationId);
  }),
);

/** Server-Sent Events: one `event:` per TutorEvent, ending with exactly one `done` (or `error`). */
function openEventStream(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx & co.)
  res.flushHeaders();
  res.write(': stream open\n\n');
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keep-alive\n\n');
  }, 15_000);
  return {
    send(event: TutorEvent) {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

tutorRouter.post(
  '/messages',
  tutorRateLimit,
  handler({ params: projectParams, body: sendMessageBody }, async ({ auth, params, body, res }) => {
    // Validation, ownership and idempotency failures are ordinary JSON errors (before the stream opens).
    const turn = await prepareTurn({
      ownerId: auth.userId,
      projectId: params.projectId,
      conversationId: body.conversationId,
      clientMessageId: body.clientMessageId,
      content: body.content,
      mode: body.mode,
      action: body.action,
    });
    const stream = openEventStream(res);
    if (turn.kind === 'replay') {
      replayTurn(turn, stream.send);
      stream.close();
      return;
    }

    const controller = new AbortController();
    // `close` on the response (not the request) is what signals a client disconnect mid-stream.
    res.on('close', () => {
      if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
    });
    const untrack = trackActiveTurn(turn.assistantId.toString(), auth.userId, controller);
    try {
      await executeTurn(turn, stream.send, controller.signal);
    } catch (err) {
      logger.error({ err }, 'Tutor stream failed');
      stream.send({ type: 'error', code: 'TUTOR_ERROR', message: 'Something went wrong while answering. Please try again.' });
    } finally {
      untrack();
      stream.close();
    }
  }),
);

tutorRouter.post(
  '/messages/:messageId/stop',
  handler({ params: messageParams }, ({ auth, params, res }) => {
    const stopped = stopActiveTurn(auth.userId, params.messageId);
    res.status(stopped ? 202 : 200);
    return { stopped };
  }),
);

tutorRouter.post(
  '/messages/:messageId/feedback',
  handler({ params: messageParams, body: feedbackBody }, async ({ auth, params, body }) => ({
    message: await submitFeedback(auth.userId, params.projectId, params.messageId, body),
  })),
);

/** "What Zoya remembers": the learner can see and delete every stored observation. */
tutorRouter.get(
  '/memory',
  handler({ params: projectParams }, async ({ auth, params }) => ({ items: await listProjectMemory(auth.userId, params.projectId) })),
);

tutorRouter.delete(
  '/memory/:itemId',
  handler({ params: memoryParams }, async ({ auth, params }) => {
    await forgetProjectMemory(auth.userId, params.projectId, params.itemId);
  }),
);
