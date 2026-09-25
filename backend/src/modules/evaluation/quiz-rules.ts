import type { IAttempt, IQuestion } from '../../models/quiz.model';
import { recordEvaluation } from './evaluation.service';
import { verdictOf, type RuleCheck } from './tutor-rules';

/**
 * Deterministic checks on every AI grading (free, synchronous): feedback says what was understood and what is
 * missing, the rubric was graded point by point with the learner's own words as evidence, the computed score
 * agrees with the model's holistic view, and neither misconceptions nor attempts to game the grader earn marks.
 */
export function gradingRuleChecks(attempt: Pick<IAttempt, 'outcome' | 'feedback' | 'grading'>, question: Pick<IQuestion, 'rubric'>): RuleCheck[] {
  const feedback = attempt.feedback;
  const flags = attempt.grading.flags ?? [];
  const outcome = attempt.outcome ?? 0;
  return [
    { name: 'feedback_present', passed: (feedback?.summary?.trim().length ?? 0) >= 20, severity: 'fail' },
    {
      name: 'feedback_specific',
      passed: (feedback?.understood.length ?? 0) + (feedback?.missing.length ?? 0) > 0,
      severity: 'warn',
      detail: 'Feedback should say what was understood and what is missing',
    },
    {
      name: 'rubric_fully_graded',
      passed: !flags.includes('key_point_count_mismatch') && (feedback?.keyPoints.length ?? 0) === (question.rubric?.keyPoints.length ?? 0),
      severity: 'warn',
    },
    { name: 'evidence_in_answer', passed: !flags.includes('evidence_not_in_answer'), severity: 'warn', detail: 'A "covered" key point quoted words the learner did not write' },
    { name: 'score_consistent', passed: !flags.includes('score_disagreement'), severity: 'warn', detail: 'Computed score and holistic judgement differ by more than 0.35' },
    {
      name: 'misconceptions_penalised',
      passed: (feedback?.misconceptions.length ?? 0) === 0 || outcome < 0.9,
      severity: 'fail',
    },
    { name: 'manipulation_not_rewarded', passed: !flags.includes('answer_flagged') || outcome <= 0.5, severity: 'fail' },
  ];
}

export async function evaluateGradingRules(attempt: IAttempt, question: IQuestion) {
  const checks = gradingRuleChecks(attempt, question);
  const failed = checks.filter((c) => !c.passed);
  return recordEvaluation({
    subjectType: 'quiz_grading',
    subjectId: attempt._id,
    evaluator: 'rules',
    feature: 'quiz.grade',
    ownerId: attempt.ownerId,
    projectId: attempt.projectId,
    scores: {
      passRate: (checks.length - failed.length) / checks.length,
      grounded: failed.some((c) => c.name === 'evidence_in_answer') ? 0 : 1,
      consistent: failed.some((c) => c.name === 'score_consistent') ? 0 : 1,
      score: attempt.outcome ?? 0,
    },
    verdict: verdictOf(checks),
    flags: failed.map((c) => c.name),
    rationale: failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ') || null,
    inputPreview: `${question.stem}\n— Answer: ${attempt.response.text ?? ''}`,
    outputPreview: `Score ${Math.round((attempt.outcome ?? 0) * 100)}% · ${attempt.feedback?.summary ?? ''}`,
    aiCallId: attempt.grading.aiCallId,
    promptVersion: attempt.grading.promptVersion,
    model: attempt.grading.model,
  });
}
