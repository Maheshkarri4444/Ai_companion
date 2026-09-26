import { registerJobHandler } from '../../jobs/registry';
import { toObjectId } from '../../lib/validation';
import { QuizSession } from '../../models/quiz.model';
import { enqueueRecommendationRefresh } from '../recommendations/recommendations.service';
import { runLearningUpdate, runRepeatedMistake } from './learning';
import { generateForSession } from './question-factory';
import { gradePendingAttempt } from './quiz.service';

export function registerQuizJobs() {
  /**
   * `quiz.pregenerate`: prepares the next question while the learner reads the feedback on the previous one.
   * Runs only when no question is on screen, so the choice always reflects the latest answer (adaptivity first).
   */
  registerJobHandler('quiz.pregenerate', async ({ job, signal }) => {
    const { sessionId } = job.payload as { sessionId: string };
    const session = await QuizSession.findById(toObjectId(sessionId), { status: 1, currentQuestionId: 1, answeredCount: 1, targetCount: 1 }).lean();
    if (!session || session.status !== 'active') return { skipped: 'session-ended' };
    if (session.currentQuestionId) return { skipped: 'question-on-screen' };
    if (session.answeredCount >= session.targetCount) return { skipped: 'no-more-questions' };
    const question = await generateForSession(session._id, { meta: { jobId: job._id.toString() }, signal });
    return question ? { questionId: question._id.toString(), status: question.status } : { skipped: 'generating-elsewhere' };
  });

  /** `quiz.grade`: open answers whose synchronous grading failed (AI outage) are graded in the background. */
  registerJobHandler('quiz.grade', async ({ job, signal }) => {
    const { attemptId } = job.payload as { attemptId: string };
    return gradePendingAttempt(attemptId, { jobId: job._id.toString(), signal, lastAttempt: job.attempts >= job.maxAttempts });
  });

  registerJobHandler('learning.update', async ({ job, signal }) => {
    const { sessionId } = job.payload as { sessionId: string };
    return runLearningUpdate(sessionId, { jobId: job._id.toString(), signal, lastAttempt: job.attempts >= job.maxAttempts });
  });

  // Repeated-mistake workflow (PRD §13): identify the pattern → update the learning context → targeted recommendation.
  registerJobHandler('learning.repeated_mistake', async ({ job, signal }) => {
    const payload = job.payload as { attemptId: string; conceptId: string };
    const result = await runRepeatedMistake(payload, { jobId: job._id.toString(), signal });
    if ('pattern' in result && job.ownerId && job.projectId) {
      await enqueueRecommendationRefresh({ ownerId: job.ownerId, projectId: job.projectId, reason: `mistake:${payload.attemptId}` });
    }
    return result;
  });
}
