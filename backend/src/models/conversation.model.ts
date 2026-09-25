import { Schema, model, type Types } from 'mongoose';

/** A Tutor thread inside one Project. Long threads keep a rolling summary instead of replaying history. */
export interface IConversation {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  spaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  /** 'auto' = first question (placeholder), 'ai' = generated, 'user' = renamed (never overwritten). */
  titleSource: 'auto' | 'ai' | 'user';
  /** Rolling summary of the first `messageCount` messages (docs/ARCHITECTURE.md §14). */
  summary: { text: string; messageCount: number; updatedAt: Date } | null;
  messageCount: number;
  lastMessageAt: Date;
  lastMessagePreview: string;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    titleSource: { type: String, enum: ['auto', 'ai', 'user'], default: 'auto' },
    summary: {
      type: new Schema({ text: String, messageCount: Number, updatedAt: Date }, { _id: false }),
      default: null,
    },
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: () => new Date() },
    lastMessagePreview: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true },
);

conversationSchema.index({ ownerId: 1, projectId: 1, lastMessageAt: -1 });
conversationSchema.index({ projectId: 1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema, 'conversations');
