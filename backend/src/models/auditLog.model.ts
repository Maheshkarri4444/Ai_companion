import { Schema, model, type Types } from 'mongoose';

/** Privileged actions (admins touching learner data) are recorded here. */
export interface IAuditLog {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  action: string;
  targetType: string;
  targetId: Types.ObjectId;
  ownerId: Types.ObjectId | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema, 'audit_logs');
