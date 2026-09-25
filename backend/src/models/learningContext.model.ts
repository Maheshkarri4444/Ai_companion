import { Schema, model, type Types } from 'mongoose';

/**
 * Persistent learner context (PRD §11): small, typed, de-duplicated facts worth remembering across sessions.
 * Retrieved by relevance for each AI request — never replayed wholesale.
 */
export const LEARNING_KINDS = [
  'goal',
  'preference',
  'strength',
  'weakness',
  'misconception',
  'mistake_pattern',
  'interest',
  'milestone',
  'note',
] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export const LEARNING_SOURCES = ['tutor', 'quiz', 'assessment', 'system', 'learner'] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export interface ILearningContext {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  /** Project scope. Preferences may be user-wide (`scope: 'user'`, projectId null) — they carry no subject knowledge. */
  projectId: Types.ObjectId | null;
  scope: 'project' | 'user';
  kind: LearningKind;
  content: string;
  embedding: number[];
  /** 0–1: how important this is for tutoring decisions. */
  salience: number;
  /** How many independent observations support it (reinforced on duplicates). */
  evidenceCount: number;
  conceptIds: Types.ObjectId[];
  source: { type: LearningSource; refId: string | null };
  status: 'active' | 'resolved' | 'archived';
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const learningContextSchema = new Schema<ILearningContext>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    scope: { type: String, enum: ['project', 'user'], default: 'project' },
    kind: { type: String, enum: LEARNING_KINDS, required: true },
    content: { type: String, required: true, maxlength: 400 },
    embedding: { type: [Number], default: [], select: false },
    salience: { type: Number, default: 0.5, min: 0, max: 1 },
    evidenceCount: { type: Number, default: 1 },
    conceptIds: { type: [Schema.Types.ObjectId], default: [] },
    source: {
      type: { type: String, enum: LEARNING_SOURCES, default: 'tutor' },
      refId: { type: String, default: null },
    },
    status: { type: String, enum: ['active', 'resolved', 'archived'], default: 'active' },
    lastObservedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

learningContextSchema.index({ ownerId: 1, projectId: 1, status: 1, kind: 1 });
learningContextSchema.index({ ownerId: 1, scope: 1, status: 1 });

export const LearningContext = model<ILearningContext>('LearningContext', learningContextSchema, 'learning_context');
