import { Schema, model, type Types } from 'mongoose';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  /** Mirrored into the session JWT (`tv`); bumping it revokes every outstanding session. */
  tokenVersion: number;
  lastLoginAt?: Date | null;
  lastActiveAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'user' },
    status: { type: String, enum: USER_STATUSES, required: true, default: 'active' },
    tokenVersion: { type: Number, required: true, default: 0 },
    lastLoginAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ lastActiveAt: -1 });

export const User = model<IUser>('User', userSchema);
