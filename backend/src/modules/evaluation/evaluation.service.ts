import type { Types } from 'mongoose';
import { logger } from '../../lib/logger';
import { truncate } from '../../lib/text';
import { AiEvaluation, type EvalSubject, type Evaluator, type Verdict } from '../../models/aiEvaluation.model';

/*
 * Evaluation store (docs/ARCHITECTURE.md §24). Every AI experience reports quality through this one shape —
 * rules (every output, synchronous and free), an LLM judge (sampled, background), learner feedback and the
 * offline regression suite — so the admin console can compare them over time and across prompt versions.
 */

export interface EvaluationInput {
  subjectType: EvalSubject;
  subjectId: Types.ObjectId | null;
  evaluator: Evaluator;
  feature: string;
  ownerId?: Types.ObjectId | null;
  projectId?: Types.ObjectId | null;
  scores: Record<string, number>;
  verdict: Verdict;
  flags?: string[];
  rationale?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  aiCallId?: Types.ObjectId | string | null;
  promptVersion?: string | null;
  model?: string | null;
}

/** Upserts one verdict per (subject, evaluator): re-evaluating replaces the previous result. */
export async function recordEvaluation(input: EvaluationInput) {
  const doc = {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    evaluator: input.evaluator,
    feature: input.feature,
    ownerId: input.ownerId ?? null,
    projectId: input.projectId ?? null,
    scores: Object.fromEntries(Object.entries(input.scores).map(([k, v]) => [k, Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000])),
    verdict: input.verdict,
    flags: [...new Set(input.flags ?? [])],
    rationale: input.rationale ? truncate(input.rationale, 600) : null,
    inputPreview: input.inputPreview ? truncate(input.inputPreview, 300) : null,
    outputPreview: input.outputPreview ? truncate(input.outputPreview, 600) : null,
    aiCallId: input.aiCallId ?? null,
    promptVersion: input.promptVersion ?? null,
    model: input.model ?? null,
  };
  try {
    if (input.subjectId) {
      return await AiEvaluation.findOneAndUpdate(
        { subjectType: input.subjectType, subjectId: input.subjectId, evaluator: input.evaluator },
        { $set: doc },
        { upsert: true, returnDocument: 'after' },
      ).lean();
    }
    return (await AiEvaluation.create(doc)).toObject();
  } catch (err) {
    logger.warn({ err: (err as Error).message, evaluator: input.evaluator }, 'Failed to record evaluation');
    return null;
  }
}

/** Judges run in the background (`ai.evaluate`); each subject type registers its own. */
type Judge = (subjectId: string, ctx: { jobId: string; signal: AbortSignal }) => Promise<Record<string, unknown>>;
const judges = new Map<EvalSubject, Judge>();

export function registerJudge(subjectType: EvalSubject, judge: Judge) {
  judges.set(subjectType, judge);
}

export function getJudge(subjectType: EvalSubject) {
  return judges.get(subjectType);
}

export const judgeJobKey = (subjectType: EvalSubject, subjectId: string) => `ai.evaluate:${subjectType}:${subjectId}`;
