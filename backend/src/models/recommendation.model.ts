import { Schema, model, type Types } from 'mongoose';

/*
 * Next-action recommendations (PRD §10, docs/ARCHITECTURE.md §19). Candidates come from deterministic rules over the
 * learner's state; the light model only rewrites the top ones in natural language from the same facts. A batch is
 * regenerated only when the underlying state changes (`stateHash`).
 */

export const RECOMMENDATION_KINDS = [
  'upload_material',
  'resume_quiz',
  'first_quiz',
  'review_weak_concept',
  'fix_repeated_mistake',
  'practice_application',
  'spaced_review',
  'assess_new_concepts',
  'ask_tutor',
  'stretch_challenge',
] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

export const RECOMMENDATION_ACTIONS = ['start_quiz', 'resume_quiz', 'review_material', 'ask_tutor', 'upload_material'] as const;
export type RecommendationActionType = (typeof RECOMMENDATION_ACTIONS)[number];

export const RECOMMENDATION_STATUSES = ['active', 'completed', 'dismissed', 'expired'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface IRecommendationAction {
  type: RecommendationActionType;
  /** start_quiz: mode, conceptIds, questionTypes, targetCount · review_material: materialId, page · ask_tutor: prompt · resume_quiz: sessionId */
  params: Record<string, unknown>;
  label: string;
}

export interface IRecommendation {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  spaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  batchId: Types.ObjectId;
  kind: RecommendationKind;
  /** Stable identity of the underlying situation (kind + concepts) — used for novelty across batches. */
  key: string;
  title: string;
  rationale: string;
  action: IRecommendationAction;
  conceptIds: Types.ObjectId[];
  /** 0–1 ranking score (severity × importance × novelty). */
  priority: number;
  status: RecommendationStatus;
  source: 'rules' | 'ai';
  stateHash: string;
  /** The facts the text was written from (shown to admins; the model saw nothing else). */
  evidence: Record<string, unknown>;
  aiCallId: Types.ObjectId | null;
  actedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const recommendationSchema = new Schema<IRecommendation>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    batchId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: RECOMMENDATION_KINDS, required: true },
    key: { type: String, required: true },
    title: { type: String, required: true, maxlength: 160 },
    rationale: { type: String, required: true, maxlength: 600 },
    action: {
      type: { type: String, enum: RECOMMENDATION_ACTIONS, required: true },
      params: { type: Schema.Types.Mixed, default: {} },
      label: { type: String, required: true },
    },
    conceptIds: { type: [Schema.Types.ObjectId], default: [] },
    priority: { type: Number, default: 0 },
    status: { type: String, enum: RECOMMENDATION_STATUSES, default: 'active' },
    source: { type: String, enum: ['rules', 'ai'], default: 'rules' },
    stateHash: { type: String, required: true },
    evidence: { type: Schema.Types.Mixed, default: {} },
    aiCallId: { type: Schema.Types.ObjectId, default: null },
    actedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false },
);

recommendationSchema.index({ ownerId: 1, projectId: 1, status: 1, priority: -1 });
recommendationSchema.index({ projectId: 1, createdAt: -1 });
recommendationSchema.index({ ownerId: 1, projectId: 1, key: 1, updatedAt: -1 });
recommendationSchema.index({ status: 1, createdAt: -1 });

export const Recommendation = model<IRecommendation>('Recommendation', recommendationSchema, 'recommendations');
