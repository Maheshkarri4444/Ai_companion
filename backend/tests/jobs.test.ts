import { describe, expect, it } from 'vitest';
import { claimJob, enqueueJob, failJob, JobError, recoverStaleJobs, retryJob } from '../src/jobs/queue';
import { registerJobHandler } from '../src/jobs/registry';
import { drainJobs, processJob } from '../src/jobs/worker';
import { Job } from '../src/models/job.model';
import { useTestDatabase } from './helpers';

useTestDatabase();

describe('durable job queue', () => {
  it('deduplicates enqueues by idempotency key', async () => {
    const a = await enqueueJob({ type: 'test.noop', idempotencyKey: 'noop:1' });
    const b = await enqueueJob({ type: 'test.noop', idempotencyKey: 'noop:1' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job._id.toString()).toBe(a.job._id.toString());
    expect(await Job.countDocuments({})).toBe(1);
  });

  it('leases each job to exactly one worker, highest priority first', async () => {
    await enqueueJob({ type: 'test.noop', idempotencyKey: 'low', priority: -1 });
    await enqueueJob({ type: 'test.noop', idempotencyKey: 'high', priority: 5 });
    const [first, second, third] = await Promise.all([
      claimJob('w1', 60_000, ['test.noop']),
      claimJob('w2', 60_000, ['test.noop']),
      claimJob('w3', 60_000, ['test.noop']),
    ]);
    const claimed = [first, second, third].filter(Boolean);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((j) => j!.lockedBy)).size).toBe(2);
    expect(claimed.map((j) => j!.idempotencyKey)).toContain('high');
  });

  it('retries retryable failures with backoff, then dead-letters after maxAttempts', async () => {
    await enqueueJob({ type: 'test.flaky', idempotencyKey: 'flaky:1', maxAttempts: 2 });
    let job = (await claimJob('w1', 60_000, ['test.flaky']))!;
    const first = await failJob(job, 'w1', { code: 'AI_UNAVAILABLE', message: 'busy', retryable: true });
    expect(first.willRetry).toBe(true);
    let stored = (await Job.findById(job._id).lean())!;
    expect(stored.status).toBe('queued');
    expect(stored.runAt.getTime()).toBeGreaterThan(Date.now() + 2000); // backoff ≈ 5 s ± 20 %

    await Job.updateOne({ _id: job._id }, { $set: { runAt: new Date() } });
    job = (await claimJob('w1', 60_000, ['test.flaky']))!;
    const second = await failJob(job, 'w1', { code: 'AI_UNAVAILABLE', message: 'still busy', retryable: true });
    expect(second.willRetry).toBe(false);
    stored = (await Job.findById(job._id).lean())!;
    expect(stored).toMatchObject({ status: 'failed', attempts: 2 });
    expect(stored.errorHistory).toHaveLength(2);

    // Operators can put a dead-lettered job back in the queue with a fresh attempt budget.
    const retried = await retryJob(job._id.toString());
    expect(retried).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('fails permanently on non-retryable handler errors and succeeds otherwise', async () => {
    registerJobHandler('test.permanent', async () => {
      throw new JobError('PDF_ENCRYPTED', 'locked');
    });
    registerJobHandler('test.ok', async ({ progress }) => {
      await progress('working', 50);
      return { value: 42 };
    });
    await enqueueJob({ type: 'test.permanent', idempotencyKey: 'perm:1' });
    await enqueueJob({ type: 'test.ok', idempotencyKey: 'ok:1' });
    const result = await drainJobs({ types: ['test.permanent', 'test.ok'] });
    expect(result).toEqual({ processed: 1, failed: 1 });
    expect(await Job.findOne({ idempotencyKey: 'perm:1' }).lean()).toMatchObject({ status: 'failed', lastError: { code: 'PDF_ENCRYPTED', retryable: false } });
    expect(await Job.findOne({ idempotencyKey: 'ok:1' }).lean()).toMatchObject({ status: 'succeeded', result: { value: 42 }, progress: { pct: 100 } });
  });

  it('recovers jobs whose worker died (expired lease)', async () => {
    await enqueueJob({ type: 'test.noop', idempotencyKey: 'stale:1' });
    const job = (await claimJob('dead-worker', 1, ['test.noop']))!;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await recoverStaleJobs()).toBe(1);
    const stored = (await Job.findById(job._id).lean())!;
    expect(stored).toMatchObject({ status: 'queued', lockedBy: null, lastError: { code: 'LEASE_EXPIRED' } });
  });

  it('never lets a worker complete a job it no longer holds', async () => {
    registerJobHandler('test.slow', async () => ({ done: true }));
    await enqueueJob({ type: 'test.slow', idempotencyKey: 'slow:1' });
    const job = (await claimJob('w1', 60_000, ['test.slow']))!;
    // Another worker took over after a lease expiry.
    await Job.updateOne({ _id: job._id }, { $set: { lockedBy: 'w2' } });
    await processJob(job, 'w1', new AbortController().signal);
    expect((await Job.findById(job._id).lean())!.status).toBe('running');
  });
});
