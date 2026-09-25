import { Schema, model, type Types } from 'mongoose';

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface IProject {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  spaceId: Types.ObjectId;
  name: string;
  description: string;
  learningGoal: string;
  status: ProjectStatus;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    learningGoal: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: PROJECT_STATUSES, required: true, default: 'active' },
    lastActivityAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

projectSchema.index({ ownerId: 1, spaceId: 1, createdAt: -1 });
projectSchema.index({ ownerId: 1, lastActivityAt: -1 });

export const Project = model<IProject>('Project', projectSchema);
