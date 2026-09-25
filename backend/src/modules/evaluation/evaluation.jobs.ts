import { enqueueJob, JobError } from '../../jobs/queue';
import { registerJobHandler } from '../../jobs/registry';
import { EVAL_SUBJECTS, type EvalSubject } from '../../models/aiEvaluation.model';
import { getJudge, judgeJobKey, registerJudge } from './evaluation.service';
import { judgeQuizQuestion } from './quiz-judge';
import { judgeTutorMessage } from './tutor-judge';

export async function enqueueJudge(input: { subjectType: EvalSubject; subjectId: string; ownerId?: string; projectId?: string; priority?: number }) {
  return enqueueJob({
    type: 'ai.evaluate',
    idempotencyKey: judgeJobKey(input.subjectType, input.subjectId),
    payload: { subjectType: input.subjectType, subjectId: input.subjectId },
    ownerId: input.ownerId,
    projectId: input.projectId,
    maxAttempts: 3,
    priority: input.priority ?? -1, // quality checks yield to learner-facing work
  });
}

export function registerEvaluationJobs() {
  registerJudge('tutor_message', judgeTutorMessage);
  registerJudge('quiz_question', judgeQuizQuestion);
  registerJobHandler('ai.evaluate', async ({ job, signal }) => {
    const { subjectType, subjectId } = job.payload as { subjectType: EvalSubject; subjectId: string };
    if (!EVAL_SUBJECTS.includes(subjectType)) throw new JobError('UNKNOWN_SUBJECT', `Unknown evaluation subject ${subjectType}`);
    const judge = getJudge(subjectType);
    if (!judge) throw new JobError('NO_JUDGE', `No judge registered for ${subjectType}`);
    return judge(subjectId, { jobId: job._id.toString(), signal });
  });
}
