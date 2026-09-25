import { Schema, model, type Types } from 'mongoose';

/** One record per gateway call (retries and model fallbacks are folded into `attempts`). */
export interface IAiCall {
  _id: Types.ObjectId;
  feature: string;
  operation: 'generate' | 'stream' | 'structured' | 'embed';
  provider: string;
  model: string | null;
  attempts: Array<{ model: string; status: 'success' | 'error'; kind?: string; ms: number; message?: string }>;
  retries: number;
  fallbackUsed: boolean;
  status: 'success' | 'error';
  errorKind: string | null;
  errorMessage: string | null;
  latencyMs: number;
  ttftMs: number | null;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; totalTokens: number; estimated: boolean };
  costUsd: number;
  promptVersion: string | null;
  ownerId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  conversationId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  jobId: Types.ObjectId | null;
  traceId: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const aiCallSchema = new Schema<IAiCall>(
  {
    feature: { type: String, required: true },
    operation: { type: String, required: true },
    provider: { type: String, required: true },
    model: { type: String, default: null },
    attempts: {
      type: [new Schema({ model: String, status: String, kind: String, ms: Number, message: String }, { _id: false })],
      default: [],
    },
    retries: { type: Number, default: 0 },
    fallbackUsed: { type: Boolean, default: false },
    status: { type: String, enum: ['success', 'error'], required: true },
    errorKind: { type: String, default: null },
    errorMessage: { type: String, default: null },
    latencyMs: { type: Number, required: true },
    ttftMs: { type: Number, default: null },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      thinkingTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimated: { type: Boolean, default: false },
    },
    costUsd: { type: Number, default: 0 },
    promptVersion: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    projectId: { type: Schema.Types.ObjectId, default: null },
    conversationId: { type: Schema.Types.ObjectId, default: null },
    messageId: { type: Schema.Types.ObjectId, default: null },
    jobId: { type: Schema.Types.ObjectId, default: null },
    traceId: { type: String, default: null },
    inputPreview: { type: String, default: null },
    outputPreview: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

aiCallSchema.index({ createdAt: -1 });
aiCallSchema.index({ feature: 1, createdAt: -1 });
aiCallSchema.index({ model: 1, createdAt: -1 });
aiCallSchema.index({ ownerId: 1, createdAt: -1 });
aiCallSchema.index({ status: 1, createdAt: -1 });
aiCallSchema.index({ traceId: 1 });
aiCallSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d' });

export const AiCall = model<IAiCall>('AiCall', aiCallSchema, 'ai_calls');
