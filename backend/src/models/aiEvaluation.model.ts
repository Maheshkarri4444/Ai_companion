import { Schema, model, type Types } from 'mongoose';

/**
 * One evaluation of one AI output (docs/ARCHITECTURE.md §24). Subjects cover every AI experience —
 * the assessment and recommendation phases write the same shape with their own subject types.
 */
export const EVAL_SUBJECTS = ['tutor_message', 'retrieval', 'quiz_question', 'quiz_grading', 'recommendation', 'material'] as const;
export type EvalSubject = (typeof EVAL_SUBJECTS)[number];

export const EVALUATORS = ['rules', 'llm_judge', 'learner_feedback', 'offline_suite'] as const;
export type Evaluator = (typeof EVALUATORS)[number];

export type Verdict = 'pass' | 'warn' | 'fail';

export interface IAiEvaluation {
  _id: Types.ObjectId;
  subjectType: EvalSubject;
  subjectId: Types.ObjectId | null;
  evaluator: Evaluator;
  feature: string;
  ownerId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  /** Normalised 0–1 scores by criterion (groundedness, citationAccuracy, relevance, …). */
  scores: Record<string, number>;
  verdict: Verdict;
  flags: string[];
  rationale: string | null;
  /** Excerpts so an operator can judge without opening the conversation. */
  inputPreview: string | null;
  outputPreview: string | null;
  aiCallId: Types.ObjectId | null;
  promptVersion: string | null;
  model: string | null;
  runId: Types.ObjectId | null;
  createdAt: Date;
}

const aiEvaluationSchema = new Schema<IAiEvaluation>(
  {
    subjectType: { type: String, enum: EVAL_SUBJECTS, required: true },
    subjectId: { type: Schema.Types.ObjectId, default: null },
    evaluator: { type: String, enum: EVALUATORS, required: true },
    feature: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    projectId: { type: Schema.Types.ObjectId, default: null },
    scores: { type: Schema.Types.Mixed, default: {} },
    verdict: { type: String, enum: ['pass', 'warn', 'fail'], required: true },
    flags: { type: [String], default: [] },
    rationale: { type: String, default: null },
    inputPreview: { type: String, default: null },
    outputPreview: { type: String, default: null },
    aiCallId: { type: Schema.Types.ObjectId, default: null },
    promptVersion: { type: String, default: null },
    model: { type: String, default: null },
    runId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

aiEvaluationSchema.index({ createdAt: -1 });
aiEvaluationSchema.index({ evaluator: 1, createdAt: -1 });
aiEvaluationSchema.index({ subjectType: 1, subjectId: 1 });
aiEvaluationSchema.index({ verdict: 1, createdAt: -1 });
aiEvaluationSchema.index({ projectId: 1 });
// One verdict per evaluator per subject: re-evaluation replaces it (offline runs live in eval_runs).
aiEvaluationSchema.index(
  { subjectType: 1, subjectId: 1, evaluator: 1 },
  { unique: true, partialFilterExpression: { subjectId: { $type: 'objectId' } } },
);

export const AiEvaluation = model<IAiEvaluation>('AiEvaluation', aiEvaluationSchema, 'ai_evaluations');

/** A run of the offline regression suite (`npm run eval:tutor`), recorded for the admin console. */
export interface IEvalRun {
  _id: Types.ObjectId;
  suite: string;
  label: string | null;
  provider: string;
  models: Record<string, unknown>;
  promptVersions: Record<string, string>;
  config: Record<string, unknown>;
  summary: {
    cases: number;
    passed: number;
    failed: number;
    passRate: number;
    metrics: Record<string, number>;
  };
  cases: Array<{
    id: string;
    category: string;
    question: string;
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail?: string }>;
    grounding: string | null;
    answerPreview: string;
    citedPages: string[];
    latencyMs: number;
  }>;
  durationMs: number;
  createdAt: Date;
}

const evalRunSchema = new Schema<IEvalRun>(
  {
    suite: { type: String, required: true },
    label: { type: String, default: null },
    provider: { type: String, required: true },
    models: { type: Schema.Types.Mixed, default: {} },
    promptVersions: { type: Schema.Types.Mixed, default: {} },
    config: { type: Schema.Types.Mixed, default: {} },
    summary: { type: Schema.Types.Mixed, default: {} },
    cases: { type: Schema.Types.Mixed, default: [] },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
evalRunSchema.index({ suite: 1, createdAt: -1 });

export const EvalRun = model<IEvalRun>('EvalRun', evalRunSchema, 'eval_runs');
