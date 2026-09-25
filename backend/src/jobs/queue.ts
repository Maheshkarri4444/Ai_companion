import { EventEmitter } from 'node:events';
import { Types } from 'mongoose';
import { getContext } from '../lib/context';
import { isDuplicateKeyError } from '../lib/errors';
import { truncate } from '../lib/text';
import { Job, type IJob, type IJobError } from '../models/job.model';

/** Throw from a handler to fail a job with a specific code; `retryable: false` sends it straight to `failed`. */
export class JobError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

type Id = string | Types.ObjectId | null | undefined;
const asId = (v: Id) => (v == null ? null : typeof v === 'string' ? new Types.ObjectId(v) : v);

export interface EnqueueInput {
  type: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  ownerId?: Id;
  projectId?: Id;
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
}

/**
 * Wakes in-process workers when a job is enqueued, so a learner-facing job (e.g. preparing the next quiz question)
 * starts at once instead of after the idle poll back-off. Separate worker processes still poll.
 */
export const jobSignals = new EventEmitter().setMaxListeners(64);

/** Idempotent: a second enqueue with the same key returns the existing job instead of creating a duplicate. */
export async function enqueueJob(input: EnqueueInput): Promise<{ job: IJob; created: boolean }> {
  try {
    const job = await Job.create({
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      ownerId: asId(input.ownerId),
      projectId: asId(input.projectId),
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 4,
      priority: input.priority ?? 0,
      traceId: getContext()?.requestId ?? null,
    });
    jobSignals.emit('enqueued', input.type);
    return { job: job.toObject(), created: true };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await Job.findOne({ idempotencyKey: input.idempotencyKey }).lean();
    if (!existing) throw err;
    return { job: existing, created: false };
  }
}

/** Atomically leases the next due job (highest priority, oldest runAt). */
export async function claimJob(workerId: string, leaseMs: number, types: string[]): Promise<IJob | null> {
  const now = new Date();
  return Job.findOneAndUpdate(
    { status: 'queued', runAt: { $lte: now }, type: { $in: types } },
    {
      $set: { status: 'running', lockedBy: workerId, lockedUntil: new Date(now.getTime() + leaseMs), startedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { priority: -1, runAt: 1 }, returnDocument: 'after' },
  ).lean();
}

export async function extendLease(jobId: Types.ObjectId, workerId: string, leaseMs: number) {
  await Job.updateOne({ _id: jobId, lockedBy: workerId, status: 'running' }, { $set: { lockedUntil: new Date(Date.now() + leaseMs) } });
}

export async function reportProgress(jobId: Types.ObjectId, stage: string, pct: number) {
  await Job.updateOne({ _id: jobId }, { $set: { progress: { stage, pct: Math.max(0, Math.min(100, Math.round(pct))) } } });
}

export async function completeJob(job: IJob, workerId: string, result: Record<string, unknown> | void) {
  const finishedAt = new Date();
  await Job.updateOne(
    { _id: job._id, lockedBy: workerId },
    {
      $set: {
        status: 'succeeded',
        result: result ?? null,
        finishedAt,
        durationMs: job.startedAt ? finishedAt.getTime() - new Date(job.startedAt).getTime() : null,
        lockedBy: null,
        lockedUntil: null,
        progress: { stage: 'done', pct: 100 },
      },
    },
  );
}

/** Exponential backoff with ±20 % jitter: 5 s, 10 s, 20 s … capped at 10 min. */
export function backoffMs(attempts: number): number {
  const base = Math.min(5000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export async function failJob(job: IJob, workerId: string, error: { code: string; message: string; retryable: boolean }) {
  const entry: IJobError = { code: error.code, message: truncate(error.message, 1000), retryable: error.retryable, at: new Date() };
  const willRetry = error.retryable && job.attempts < job.maxAttempts;
  const finishedAt = new Date();
  await Job.updateOne(
    { _id: job._id, lockedBy: workerId },
    {
      $set: willRetry
        ? { status: 'queued', runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedBy: null, lockedUntil: null, lastError: entry }
        : {
            status: 'failed',
            lastError: entry,
            lockedBy: null,
            lockedUntil: null,
            finishedAt,
            durationMs: job.startedAt ? finishedAt.getTime() - new Date(job.startedAt).getTime() : null,
          },
      $push: { errorHistory: { $each: [entry], $slice: -5 } },
    },
  );
  return { willRetry };
}

/** Jobs whose worker died (lease expired) go back to the queue; the attempt already counted. */
export async function recoverStaleJobs(): Promise<number> {
  const now = new Date();
  const entry: IJobError = { code: 'LEASE_EXPIRED', message: 'Worker lease expired; job requeued', retryable: true, at: now };
  const res = await Job.updateMany(
    { status: 'running', lockedUntil: { $lt: now } },
    { $set: { status: 'queued', lockedBy: null, lockedUntil: null, runAt: now, lastError: entry }, $push: { errorHistory: { $each: [entry], $slice: -5 } } },
  );
  return res.modifiedCount;
}

export async function cancelQueuedJobs(filter: Record<string, unknown>): Promise<number> {
  const res = await Job.updateMany({ ...filter, status: 'queued' }, { $set: { status: 'cancelled', finishedAt: new Date() } });
  return res.modifiedCount;
}

/** Admin action: put a failed/cancelled job back in the queue with a fresh attempt budget. */
export async function retryJob(jobId: string): Promise<IJob | null> {
  return Job.findOneAndUpdate(
    { _id: new Types.ObjectId(jobId), status: { $in: ['failed', 'cancelled'] } },
    { $set: { status: 'queued', runAt: new Date(), attempts: 0, lockedBy: null, lockedUntil: null, finishedAt: null } },
    { returnDocument: 'after' },
  ).lean();
}
