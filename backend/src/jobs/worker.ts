import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { AIError } from '../ai/errors';
import { config } from '../config/env';
import { runWithContext } from '../lib/context';
import { logger } from '../lib/logger';
import { sleep } from '../lib/semaphore';
import { WorkerHeartbeat, type IJob } from '../models/job.model';
import { claimJob, completeJob, enqueueJob, extendLease, failJob, JobError, jobSignals, reportProgress } from './queue';
import { getJobHandler, registeredJobTypes } from './registry';

const LEASE_MS = 90_000;
const HEARTBEAT_MS = 10_000;
const SCHEDULE_MS = 60_000;

/** Idle wait that ends early when a job is enqueued in this process (or the worker stops). */
function waitForWork(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      jobSignals.off('enqueued', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    jobSignals.on('enqueued', done);
    signal.addEventListener('abort', done, { once: true });
  });
}

function classifyJobError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof JobError) return { code: err.code, message: err.message, retryable: err.retryable };
  if (err instanceof AIError) return { code: `AI_${err.kind.toUpperCase()}`, message: err.message, retryable: err.retryable };
  const e = err as { name?: string; message?: string };
  const transient = /Mongo(Network|ServerSelection|NotConnected)|ECONNRESET|ETIMEDOUT/i.test(`${e?.name} ${e?.message}`);
  return { code: transient ? 'TRANSIENT' : 'UNEXPECTED', message: e?.message ?? String(err), retryable: true };
}

/**
 * Polls the durable queue with N concurrent slots. Leases are extended while a job runs; on shutdown the
 * worker stops claiming, aborts handlers and gives them time to settle (docs/ARCHITECTURE.md §10).
 */
export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 6)}`;
  private running = false;
  private readonly active = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private timers: NodeJS.Timeout[] = [];
  private stats = { running: 0, processed: 0, failed: 0 };
  private readonly startedAt = new Date();

  constructor(private readonly opts: { concurrency: number; pollMs: number }) {}

  start() {
    if (this.running) return;
    this.running = true;
    logger.info({ workerId: this.id, types: registeredJobTypes(), concurrency: this.opts.concurrency }, 'Worker started');
    for (let slot = 0; slot < this.opts.concurrency; slot++) void this.loop(slot);
    void this.beat();
    this.timers.push(setInterval(() => void this.beat(), HEARTBEAT_MS));
    void this.schedule();
    this.timers.push(setInterval(() => void this.schedule(), SCHEDULE_MS));
  }

  async stop(timeoutMs = 15_000) {
    if (!this.running) return;
    this.running = false;
    this.timers.forEach(clearInterval);
    this.shutdown.abort(new Error('Worker shutting down'));
    await Promise.race([Promise.allSettled([...this.active]), sleep(timeoutMs)]);
    await WorkerHeartbeat.deleteOne({ _id: this.id }).catch(() => undefined);
    logger.info({ workerId: this.id }, 'Worker stopped');
  }

  /** Recurring maintenance, deduplicated across workers by a per-minute idempotency key. */
  private async schedule() {
    const minute = new Date().toISOString().slice(0, 16);
    await enqueueJob({ type: 'system.reconcile', idempotencyKey: `system.reconcile:${minute}`, maxAttempts: 1, priority: 5 }).catch((err) =>
      logger.warn({ err }, 'Failed to schedule reconcile'),
    );
  }

  private async beat() {
    await WorkerHeartbeat.updateOne(
      { _id: this.id },
      {
        $set: {
          host: hostname(),
          pid: process.pid,
          role: config.APP_ROLE,
          version: config.APP_VERSION,
          startedAt: this.startedAt,
          lastBeatAt: new Date(),
          concurrency: this.opts.concurrency,
          ...this.stats,
        },
      },
      { upsert: true },
    ).catch((err) => logger.warn({ err }, 'Worker heartbeat failed'));
  }

  private async loop(slot: number) {
    let idle = this.opts.pollMs;
    while (this.running) {
      let job: IJob | null = null;
      try {
        job = await claimJob(this.id, LEASE_MS, registeredJobTypes());
      } catch (err) {
        logger.warn({ err, slot }, 'Job claim failed');
      }
      if (!job) {
        await waitForWork(idle, this.shutdown.signal);
        idle = Math.min(idle * 1.5, this.opts.pollMs * 5); // back off while the queue is empty
        continue;
      }
      idle = this.opts.pollMs;
      const run = this.run(job);
      this.active.add(run);
      await run;
      this.active.delete(run);
    }
  }

  private async run(job: IJob) {
    this.stats.running++;
    const leaseTimer = setInterval(() => void extendLease(job._id, this.id, LEASE_MS).catch(() => undefined), LEASE_MS / 3);
    try {
      const ok = await processJob(job, this.id, this.shutdown.signal);
      if (ok) this.stats.processed++;
      else this.stats.failed++;
    } finally {
      clearInterval(leaseTimer);
      this.stats.running--;
    }
  }
}

/** Runs one claimed job through its handler and records the outcome. Returns true on success. */
export async function processJob(job: IJob, workerId: string, signal: AbortSignal): Promise<boolean> {
  const handler = getJobHandler(job.type);
  const log = logger.child({ jobId: job._id.toString(), jobType: job.type, attempt: job.attempts });
  const started = Date.now();
  try {
    if (!handler) throw new JobError('NO_HANDLER', `No handler registered for ${job.type}`);
    const result = await runWithContext({ requestId: job.traceId ?? `job-${job._id.toString()}` }, () =>
      handler({ job, signal, progress: (stage, pct) => reportProgress(job._id, stage, pct) }),
    );
    await completeJob(job, workerId, result);
    log.info({ ms: Date.now() - started }, 'Job succeeded');
    return true;
  } catch (err) {
    const failure = classifyJobError(err);
    const { willRetry } = await failJob(job, workerId, failure).catch(() => ({ willRetry: false }));
    log.warn({ code: failure.code, willRetry, err: failure.message }, 'Job failed');
    return false;
  }
}

/**
 * Synchronously processes due jobs until the queue is empty (tests, the evaluation runner and one-off
 * scripts use it instead of a polling worker).
 */
export async function drainJobs(options: { types?: string[]; maxJobs?: number } = {}) {
  const workerId = `drain:${process.pid}`;
  const signal = new AbortController().signal;
  const types = options.types ?? registeredJobTypes();
  let processed = 0;
  let failed = 0;
  while (processed + failed < (options.maxJobs ?? 100)) {
    const job = await claimJob(workerId, LEASE_MS, types);
    if (!job) break;
    if (await processJob(job, workerId, signal)) processed++;
    else failed++;
  }
  return { processed, failed };
}

let worker: Worker | null = null;

export function startWorker() {
  worker ??= new Worker({ concurrency: config.WORKER_CONCURRENCY, pollMs: config.WORKER_POLL_MS });
  worker.start();
  return worker;
}

export async function stopWorker() {
  await worker?.stop();
  worker = null;
}
