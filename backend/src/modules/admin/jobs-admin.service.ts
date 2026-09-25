import { retryJob } from '../../jobs/queue';
import { registeredJobTypes } from '../../jobs/registry';
import { AppError } from '../../lib/errors';
import { toObjectId, type Paginated } from '../../lib/validation';
import { AuditLog } from '../../models/auditLog.model';
import { Job, WorkerHeartbeat, type IJob } from '../../models/job.model';
import { Material } from '../../models/material.model';
import { userRefs } from './admin.service';
import type { JobsQuery } from './admin.schemas';

/** A worker counts as alive when it has sent a heartbeat recently (it beats every 10 s). */
const ALIVE_MS = 45_000;

function toJobDto(job: IJob) {
  return {
    id: job._id.toString(),
    type: job.type,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    lockedBy: job.lockedBy,
    progress: job.progress,
    lastError: job.lastError,
    ownerId: job.ownerId?.toString() ?? null,
    projectId: job.projectId?.toString() ?? null,
    idempotencyKey: job.idempotencyKey,
    durationMs: job.durationMs,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

export async function getWorkerStatus() {
  const beats = await WorkerHeartbeat.find({}).sort({ lastBeatAt: -1 }).limit(20).lean();
  const now = Date.now();
  const workers = beats.map((b) => ({
    id: b._id,
    host: b.host,
    pid: b.pid,
    role: b.role,
    version: b.version,
    startedAt: b.startedAt,
    lastBeatAt: b.lastBeatAt,
    alive: now - new Date(b.lastBeatAt).getTime() < ALIVE_MS,
    concurrency: b.concurrency,
    running: b.running,
    processed: b.processed,
    failed: b.failed,
  }));
  return { alive: workers.filter((w) => w.alive).length, workers };
}

export async function getJobsOverview() {
  const since24h = new Date(Date.now() - 86_400_000);
  const now = new Date();
  const [byTypeStatus, dueNow, delayed, running, oldestQueued, last24h, recentFailures, workers] = await Promise.all([
    Job.aggregate<{ _id: { type: string; status: string }; n: number; avgMs: number | null }>([
      { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } } },
      { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 }, avgMs: { $avg: '$durationMs' } } },
    ]),
    Job.countDocuments({ status: 'queued', runAt: { $lte: now } }),
    Job.countDocuments({ status: 'queued', runAt: { $gt: now } }),
    Job.countDocuments({ status: 'running' }),
    Job.findOne({ status: 'queued', runAt: { $lte: now } }, { runAt: 1 }).sort({ runAt: 1 }).lean(),
    Job.aggregate<{ _id: string; n: number }>([
      { $match: { finishedAt: { $gte: since24h } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Job.find({ status: 'failed' }).sort({ finishedAt: -1 }).limit(8).lean(),
    getWorkerStatus(),
  ]);

  const types = [...new Set([...registeredJobTypes(), ...byTypeStatus.map((r) => r._id.type)])].sort();
  return {
    queue: {
      dueNow,
      delayed,
      running,
      oldestQueuedSec: oldestQueued ? Math.round((now.getTime() - new Date(oldestQueued.runAt).getTime()) / 1000) : 0,
    },
    last24h: {
      succeeded: last24h.find((r) => r._id === 'succeeded')?.n ?? 0,
      failed: last24h.find((r) => r._id === 'failed')?.n ?? 0,
      cancelled: last24h.find((r) => r._id === 'cancelled')?.n ?? 0,
    },
    byType: types.map((type) => {
      const rows = byTypeStatus.filter((r) => r._id.type === type);
      const count = (status: string) => rows.find((r) => r._id.status === status)?.n ?? 0;
      const succeeded = rows.find((r) => r._id.status === 'succeeded');
      return {
        type,
        queued: count('queued'),
        running: count('running'),
        succeeded: count('succeeded'),
        failed: count('failed'),
        cancelled: count('cancelled'),
        avgDurationMs: succeeded?.avgMs ? Math.round(succeeded.avgMs) : null,
      };
    }),
    recentFailures: recentFailures.map(toJobDto),
    workers,
  };
}

export async function listJobs(query: JobsQuery): Promise<Paginated<unknown>> {
  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.userId) filter.ownerId = toObjectId(query.userId);
  const [total, jobs] = await Promise.all([
    Job.countDocuments(filter),
    Job.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);
  const users = await userRefs(jobs.flatMap((j) => (j.ownerId ? [j.ownerId] : [])));
  return {
    items: jobs.map((j) => ({ ...toJobDto(j), user: j.ownerId ? (users.get(j.ownerId.toString()) ?? null) : null })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getJob(jobId: string) {
  const job = await Job.findById(toObjectId(jobId)).lean();
  if (!job) throw AppError.notFound('Job');
  const users = await userRefs(job.ownerId ? [job.ownerId] : []);
  return {
    job: {
      ...toJobDto(job),
      payload: job.payload,
      result: job.result,
      errorHistory: job.errorHistory,
      traceId: job.traceId,
    },
    user: job.ownerId ? (users.get(job.ownerId.toString()) ?? null) : null,
  };
}

/** Dead-letter recovery by an operator (audited). A failed material is put back into the queued state too. */
export async function retryJobAsAdmin(adminId: string, jobId: string, meta: { ip?: string; userAgent?: string }) {
  const job = await retryJob(jobId);
  if (!job) throw AppError.conflict('NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried.');
  if (job.type === 'material.process' && typeof job.payload.materialId === 'string') {
    await Material.updateOne(
      { _id: toObjectId(job.payload.materialId), status: 'failed', 'processing.version': Number(job.payload.version) },
      { $set: { status: 'queued', 'processing.error': null, 'processing.stage': 'queued' } },
    );
  }
  await AuditLog.create({
    actorId: toObjectId(adminId),
    action: 'admin.job.retried',
    targetType: 'job',
    targetId: job._id,
    ownerId: job.ownerId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return toJobDto(job);
}
