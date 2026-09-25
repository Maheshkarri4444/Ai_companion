import { Schema, model, type Types } from 'mongoose';

export const GROUNDING_STATUSES = ['grounded', 'partial', 'insufficient', 'general', 'conversational'] as const;
export type GroundingStatus = (typeof GROUNDING_STATUSES)[number];

export const MESSAGE_STATUSES = ['streaming', 'complete', 'stopped', 'error'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Evidence shown to the model as [S#] and to the learner as "Source: Title — Page N". */
export interface IMessageSource {
  ref: string;
  kind: 'chunk' | 'page';
  chunkId: Types.ObjectId | null;
  materialId: Types.ObjectId;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  snippet: string;
  score: number | null;
  origin: 'retrieval' | 'tool' | 'carried';
  cited: boolean;
  flagged: boolean;
}

export interface IToolCall {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  summary: string;
  latencyMs: number;
  /** Server-built data for the UI (e.g. a "Start quiz" link); never model-authored. */
  data?: Record<string, unknown> | null;
}

export interface IMessage {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  /** User messages: client-generated id that makes retries idempotent (unique per owner). */
  clientMessageId: string | null;
  /** Assistant messages: the user message they answer. */
  replyTo: Types.ObjectId | null;
  status: MessageStatus;
  mode: 'auto' | 'general';
  action: string | null;
  intent: string | null;
  grounding: {
    status: GroundingStatus | null;
    sufficiency: 'strong' | 'weak' | 'none' | null;
    topScore: number | null;
    method: string | null;
    invalidCitations: number;
    degraded: boolean;
  };
  sources: IMessageSource[];
  suggestions: string[];
  toolCalls: IToolCall[];
  feedback: { rating: 'up' | 'down'; reason: string | null; comment: string | null; at: Date } | null;
  error: { code: string; message: string } | null;
  metrics: {
    latencyMs: number | null;
    ttftMs: number | null;
    understandMs: number | null;
    retrieveMs: number | null;
    generateMs: number | null;
    rounds: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    costUsd: number;
    model: string | null;
    fallbackUsed: boolean;
  };
  /** Diagnostics for the admin console: rewritten query, retrieval trace, context blocks, flags. */
  trace: Record<string, unknown>;
  aiCallIds: Types.ObjectId[];
  promptVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sourceSchema = new Schema<IMessageSource>(
  {
    ref: String,
    kind: { type: String, enum: ['chunk', 'page'], default: 'chunk' },
    chunkId: { type: Schema.Types.ObjectId, default: null },
    materialId: Schema.Types.ObjectId,
    materialTitle: String,
    pageStart: Number,
    pageEnd: Number,
    sectionTitle: { type: String, default: null },
    snippet: String,
    score: { type: Number, default: null },
    origin: { type: String, enum: ['retrieval', 'tool', 'carried'], default: 'retrieval' },
    cited: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
  },
  { _id: false },
);

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    clientMessageId: { type: String, default: null },
    replyTo: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'complete' },
    mode: { type: String, enum: ['auto', 'general'], default: 'auto' },
    action: { type: String, default: null },
    intent: { type: String, default: null },
    grounding: {
      status: { type: String, enum: [...GROUNDING_STATUSES, null], default: null },
      sufficiency: { type: String, enum: ['strong', 'weak', 'none', null], default: null },
      topScore: { type: Number, default: null },
      method: { type: String, default: null },
      invalidCitations: { type: Number, default: 0 },
      degraded: { type: Boolean, default: false },
    },
    sources: { type: [sourceSchema], default: [] },
    suggestions: { type: [String], default: [] },
    toolCalls: {
      type: [
        new Schema(
          { name: String, args: Schema.Types.Mixed, ok: Boolean, error: String, summary: String, latencyMs: Number, data: { type: Schema.Types.Mixed, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
    feedback: {
      type: new Schema({ rating: String, reason: String, comment: String, at: Date }, { _id: false }),
      default: null,
    },
    error: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },
    metrics: {
      latencyMs: { type: Number, default: null },
      ttftMs: { type: Number, default: null },
      understandMs: { type: Number, default: null },
      retrieveMs: { type: Number, default: null },
      generateMs: { type: Number, default: null },
      rounds: { type: Number, default: 0 },
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      thinkingTokens: { type: Number, default: 0 },
      costUsd: { type: Number, default: 0 },
      model: { type: String, default: null },
      fallbackUsed: { type: Boolean, default: false },
    },
    trace: { type: Schema.Types.Mixed, default: {} },
    aiCallIds: { type: [Schema.Types.ObjectId], default: [] },
    promptVersion: { type: String, default: null },
  },
  { timestamps: true, minimize: false },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ ownerId: 1, projectId: 1, createdAt: -1 });
messageSchema.index({ replyTo: 1 });
messageSchema.index({ status: 1, updatedAt: 1 });
messageSchema.index({ 'feedback.rating': 1, createdAt: -1 });
// Idempotent sends: retrying a message with the same client id never creates a second question.
messageSchema.index(
  { ownerId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);

export const Message = model<IMessage>('Message', messageSchema, 'messages');
