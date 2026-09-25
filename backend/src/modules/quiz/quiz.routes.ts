import { Router } from 'express';
import { handler } from '../../lib/handler';
import { quizRateLimit } from '../../middleware/rateLimits';
import { answerBody, projectParams, questionParams, reportBody, sessionParams, startQuizBody } from './quiz.schemas';
import { completeQuiz, getQuizOverview, getQuizSession, nextQuestion, reportQuizItem, startQuiz, submitAnswer } from './quiz.service';

// Mounted under /api/projects/:projectId/quizzes (authentication applied by the parent router).
export const quizRouter = Router({ mergeParams: true });

quizRouter.get('/', handler({ params: projectParams }, ({ auth, params }) => getQuizOverview(auth.userId, params.projectId)));

quizRouter.post(
  '/',
  quizRateLimit,
  handler({ params: projectParams, body: startQuizBody }, async ({ auth, params, body, res }) => {
    res.status(201);
    return { session: await startQuiz(auth.userId, params.projectId, body) };
  }),
);

quizRouter.get(
  '/:sessionId',
  handler({ params: sessionParams }, ({ auth, params }) => getQuizSession(auth.userId, params.projectId, params.sessionId)),
);

/** The current question (idempotent), a pre-generated one, or a fresh one; `preparing: true` → poll again shortly. */
quizRouter.post(
  '/:sessionId/next',
  quizRateLimit,
  handler({ params: sessionParams }, async ({ auth, params, res }) => {
    const result = await nextQuestion(auth.userId, params.projectId, params.sessionId);
    if (result.preparing) res.status(202);
    return result;
  }),
);

quizRouter.post(
  '/:sessionId/questions/:questionId/answer',
  quizRateLimit,
  handler({ params: questionParams, body: answerBody }, ({ auth, params, body }) =>
    submitAnswer(auth.userId, params.projectId, params.sessionId, params.questionId, body),
  ),
);

quizRouter.post(
  '/:sessionId/questions/:questionId/report',
  handler({ params: questionParams, body: reportBody }, ({ auth, params, body }) =>
    reportQuizItem(auth.userId, params.projectId, params.sessionId, params.questionId, body),
  ),
);

quizRouter.post(
  '/:sessionId/complete',
  handler({ params: sessionParams }, async ({ auth, params }) => ({ session: await completeQuiz(auth.userId, params.projectId, params.sessionId) })),
);
