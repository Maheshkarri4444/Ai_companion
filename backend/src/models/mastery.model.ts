import { Schema, model, type Types } from 'mongoose';
import { COGNITIVE_LEVELS, QUESTION_TYPES, type CognitiveLevel, type QuestionType } from './quiz.model';

/*
 * Concept mastery (PRD §10, docs/ARCHITECTURE.md §17): an Elo/IRT-style ability estimate per learner, Project
 * and concept, updated only by assessment evidence. Every update also writes a snapshot — the history the
 * growth analysis reads.
 */

export interface ILevelStat {
  n: number;
  sum: number;
}

export interface IMastery {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  conceptId: Types.ObjectId;
  /** Ability on the logit scale, clamped to [-4, 4]; mastery = σ(θ) after decay. */
  theta: number;
  evidenceCount: number;
  correctCount: number;
  scoreSum: number;
  byLevel: Record<CognitiveLevel, ILevelStat>;
  byType: Record<QuestionType, ILevelStat>;
  /** Last 10 outcomes (0–1), oldest first. */
  recentOutcomes: number[];
  /** Recently applied attempts: re-applying one is a no-op (exactly-once updates across retries). */
  appliedAttemptIds: Types.ObjectId[];
  lastPracticedAt: Date | null;
  /** Optimistic concurrency: two answers on the same concept never overwrite each other. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const statSchema = new Schema<ILevelStat>({ n: { type: Number, default: 0 }, sum: { type: Number, default: 0 } }, { _id: false });
const statsFor = <T extends readonly string[]>(keys: T) =>
  Object.fromEntries(keys.map((k) => [k, { type: statSchema, default: () => ({ n: 0, sum: 0 }) }]));

const masterySchema = new Schema<IMastery>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    conceptId: { type: Schema.Types.ObjectId, ref: 'Concept', required: true },
    theta: { type: Number, default: 0 },
    evidenceCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    scoreSum: { type: Number, default: 0 },
    byLevel: statsFor(COGNITIVE_LEVELS),
    byType: statsFor(QUESTION_TYPES),
    recentOutcomes: { type: [Number], default: [] },
    appliedAttemptIds: { type: [Schema.Types.ObjectId], default: [] },
    lastPracticedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

masterySchema.index({ ownerId: 1, projectId: 1, conceptId: 1 }, { unique: true });
masterySchema.index({ projectId: 1 });

export const Mastery = model<IMastery>('Mastery', masterySchema, 'mastery');

export interface IMasterySnapshot {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  conceptId: Types.ObjectId;
  /** σ(θ) right after the update (no decay: decay is applied when reading). */
  mastery: number;
  theta: number;
  evidenceCount: number;
  cause: { type: 'attempt'; attemptId: Types.ObjectId; sessionId: Types.ObjectId | null };
  createdAt: Date;
}

const snapshotSchema = new Schema<IMasterySnapshot>(
  {
    ownerId: { type: Schema.Types.ObjectId, required: true },
    projectId: { type: Schema.Types.ObjectId, required: true },
    conceptId: { type: Schema.Types.ObjectId, required: true },
    mastery: { type: Number, required: true },
    theta: { type: Number, required: true },
    evidenceCount: { type: Number, required: true },
    cause: {
      type: { type: String, enum: ['attempt'], default: 'attempt' },
      attemptId: { type: Schema.Types.ObjectId, required: true },
      sessionId: { type: Schema.Types.ObjectId, default: null },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

snapshotSchema.index({ projectId: 1, conceptId: 1, createdAt: 1 });
snapshotSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
// A retried update never writes a second snapshot for the same attempt.
snapshotSchema.index({ conceptId: 1, 'cause.attemptId': 1 }, { unique: true });

export const MasterySnapshot = model<IMasterySnapshot>('MasterySnapshot', snapshotSchema, 'mastery_snapshots');
