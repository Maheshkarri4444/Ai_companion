import { Schema, model, type Types } from 'mongoose';

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface IJobError {
  code: string;
  message: string;
  retryable: boolean;
  at: Date;
}

export interface IJob {
  _id: Types.ObjectId;
  type: string;
  payload: Record<string, unknown>;
  ownerId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastError: IJobError | null;
  errorHistory: IJobError[];
  /** Duplicate enqueues with the same key return the existing job (idempotency). */
  idempotencyKey: string;
  traceId: string | null;
  progress: { stage: string | null; pct: number };
  result: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const errorSchema = new Schema<IJobError>(
  { code: String, message: String, retryable: Boolean, at: Date },
  { _id: false },
);

const jobSchema = new Schema<IJob>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    projectId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: JOB_STATUSES, required: true, default: 'queued' },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    runAt: { type: Date, required: true, default: () => new Date() },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    lastError: { type: errorSchema, default: null },
    errorHistory: { type: [errorSchema], default: [] },
    idempotencyKey: { type: String, required: true },
    traceId: { type: String, default: null },
    progress: {
      stage: { type: String, default: null },
      pct: { type: Number, default: 0 },
    },
    result: { type: Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
  },
  { timestamps: true, minimize: false },
);

jobSchema.index({ status: 1, priority: -1, runAt: 1 });
jobSchema.index({ idempotencyKey: 1 }, { unique: true });
jobSchema.index({ type: 1, status: 1, createdAt: -1 });
jobSchema.index({ status: 1, lockedUntil: 1 });
jobSchema.index({ ownerId: 1, createdAt: -1 });
jobSchema.index({ createdAt: -1 });

export const Job = model<IJob>('Job', jobSchema, 'jobs');

export interface IWorkerHeartbeat {
  _id: string;
  host: string;
  pid: number;
  role: string;
  version: string;
  startedAt: Date;
  lastBeatAt: Date;
  concurrency: number;
  running: number;
  processed: number;
  failed: number;
}

const heartbeatSchema = new Schema<IWorkerHeartbeat>({
  _id: { type: String, required: true },
  host: String,
  pid: Number,
  role: String,
  version: String,
  startedAt: Date,
  lastBeatAt: { type: Date, index: true },
  concurrency: Number,
  running: Number,
  processed: Number,
  failed: Number,
});

export const WorkerHeartbeat = model<IWorkerHeartbeat>('WorkerHeartbeat', heartbeatSchema, 'worker_heartbeats');
