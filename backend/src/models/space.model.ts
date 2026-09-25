import { Schema, model, type Types } from 'mongoose';
import { SPACE_COLORS, SPACE_ICONS, type SpaceColor, type SpaceIcon } from '../lib/constants';

export interface ISpace {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  description: string;
  color: SpaceColor;
  icon: SpaceIcon;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const spaceSchema = new Schema<ISpace>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    color: { type: String, enum: SPACE_COLORS, required: true, default: 'blue' },
    icon: { type: String, enum: SPACE_ICONS, required: true, default: 'book' },
    lastActivityAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

spaceSchema.index({ ownerId: 1, lastActivityAt: -1 });

export const Space = model<ISpace>('Space', spaceSchema);
