import { Schema, model, type Types } from 'mongoose';

export const MATERIAL_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export interface IMaterialProcessing {
  /** Bumped on every (re)processing request; the job idempotency key includes it. */
  version: number;
  stage: string | null;
  progress: number;
  attempts: number;
  jobId: Types.ObjectId | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  completedStages: string[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface IMaterial {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  spaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storage: { provider: 'gridfs'; fileId: Types.ObjectId };
  status: MaterialStatus;
  processing: IMaterialProcessing;
  pageCount: number | null;
  stats: { chunkCount: number; conceptCount: number; ocrPageCount: number };
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const materialSchema = new Schema<IMaterial>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    originalFilename: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true },
    storage: {
      provider: { type: String, enum: ['gridfs'], required: true, default: 'gridfs' },
      fileId: { type: Schema.Types.ObjectId, required: true },
    },
    status: { type: String, enum: MATERIAL_STATUSES, required: true, default: 'queued' },
    // Written by the processing pipeline (Phase 2); initialised on upload.
    processing: {
      version: { type: Number, default: 1 },
      stage: { type: String, default: null },
      progress: { type: Number, default: 0, min: 0, max: 100 },
      attempts: { type: Number, default: 0 },
      jobId: { type: Schema.Types.ObjectId, default: null },
      startedAt: { type: Date, default: null },
      finishedAt: { type: Date, default: null },
      completedStages: { type: [String], default: [] },
      error: {
        type: new Schema(
          { code: String, message: String, retryable: Boolean },
          { _id: false },
        ),
        default: null,
      },
    },
    pageCount: { type: Number, default: null },
    stats: {
      chunkCount: { type: Number, default: 0 },
      conceptCount: { type: Number, default: 0 },
      ocrPageCount: { type: Number, default: 0 },
    },
    summary: { type: String, default: null },
  },
  { timestamps: true },
);

materialSchema.index({ projectId: 1, createdAt: -1 });
materialSchema.index({ ownerId: 1, createdAt: -1 });
// The same file cannot be added twice to one Project (also closes the race between concurrent uploads).
materialSchema.index({ projectId: 1, sha256: 1 }, { unique: true });
materialSchema.index({ status: 1, updatedAt: 1 });

export const Material = model<IMaterial>('Material', materialSchema);
