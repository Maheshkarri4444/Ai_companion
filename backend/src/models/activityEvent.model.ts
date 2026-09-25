import { Schema, model, type Types } from 'mongoose';

/** Event catalogue (docs/ARCHITECTURE.md §11). Later phases append to this list. */
export const ACTIVITY_TYPES = [
  'user.registered',
  'user.logged_in',
  'space.created',
  'space.updated',
  'space.deleted',
  'project.created',
  'project.updated',
  'project.deleted',
  'material.uploaded',
  'material.updated',
  'material.deleted',
  'material.processed',
  'material.failed',
  'material.reprocessed',
  'tutor.answered',
  'tutor.feedback',
  'quiz.started',
  'quiz.question_answered',
  'quiz.completed',
  'mastery.updated',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface IActivityEvent {
  _id: Types.ObjectId;
  /** Whose learning data the event belongs to (drives user feeds and isolation). */
  ownerId: Types.ObjectId;
  /** Who performed the action — differs from ownerId for admin or system actions. */
  actorId: Types.ObjectId | null;
  type: ActivityType;
  spaceId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  materialId: Types.ObjectId | null;
  /** Name snapshots etc., so history stays readable after renames and deletes. */
  metadata: Record<string, unknown>;
  /** Optional idempotency key: recording the same event twice is a no-op. */
  eventKey?: string;
  createdAt: Date;
}

const activityEventSchema = new Schema<IActivityEvent>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    spaceId: { type: Schema.Types.ObjectId, default: null },
    projectId: { type: Schema.Types.ObjectId, default: null },
    materialId: { type: Schema.Types.ObjectId, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    eventKey: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

activityEventSchema.index({ ownerId: 1, createdAt: -1 });
activityEventSchema.index({ projectId: 1, createdAt: -1 });
activityEventSchema.index({ spaceId: 1, createdAt: -1 });
activityEventSchema.index({ type: 1, createdAt: -1 });
activityEventSchema.index({ createdAt: -1 });
activityEventSchema.index(
  { eventKey: 1 },
  { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } },
);

export const ActivityEvent = model<IActivityEvent>('ActivityEvent', activityEventSchema, 'activity_events');
