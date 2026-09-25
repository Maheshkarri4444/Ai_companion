import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueJob, JobError } from '../src/jobs/queue';
import { registerJobHandler } from '../src/jobs/registry';
import { drainJobs } from '../src/jobs/worker';
import { AiCall } from '../src/models/aiCall.model';
import { AiEvaluation } from '../src/models/aiEvaluation.model';
import { AuditLog } from '../src/models/auditLog.model';
import { installMockAI, parseSse, seedKnowledge, textParser } from './ai-helpers';
import { createProject, createSpace, loginAsNewAdmin, registerLearner, useTestDatabase, XRW, type Agent } from './helpers';

useTestDatabase();

describe('admin — AI usage, evaluation and background processing', () => {
  let admin: Agent;
  let learner: Agent;
  let learnerId: string;
  let projectId: string;
  let messageId: string;

  beforeEach(async () => {
    installMockAI();
    admin = await loginAsNewAdmin();
    let user;
    ({ agent: learner, user } = await registerLearner());
    learnerId = user.id;
    const space = await createSpace(learner);
    projectId = (await createProject(learner, space.id)).id;
    await seedKnowledge(projectId);
    const res = await learner
      .post(`/api/projects/${projectId}/tutor/messages`)
      .set(XRW)
      .send({ clientMessageId: randomUUID(), content: 'How does backpropagation compute gradients?' })
      .buffer(true)
      .parse(textParser);
    const done = parseSse(res.body as unknown as string).find((e) => e.type === 'done') as unknown as { message: { id: string } };
    messageId = done.message.id;
    await vi.waitFor(async () => expect(await AiCall.countDocuments({ feature: 'tutor.answer' })).toBe(1));
  });

  it('reports usage by feature and model with latency percentiles and cost', async () => {
    const res = await admin.get('/api/admin/ai/overview?range=24h');
    expect(res.status).toBe(200);
    expect(res.body.totals.calls).toBeGreaterThanOrEqual(2);
    expect(res.body.totals).toHaveProperty('p95LatencyMs');
    expect(res.body.byFeature.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['tutor.answer', 'embed.query']));
    expect(res.body.series).toHaveLength(24);
    expect(res.body.topUsers[0].user.id).toBe(learnerId);
    expect(res.body.gateway).toHaveProperty('breakers');
  });

  it('explains a single call: attempts, the request waterfall and the retrieval trace', async () => {
    const list = await admin.get('/api/admin/ai/calls?feature=tutor.answer');
    expect(list.body.total).toBe(1);
    const detail = await admin.get(`/api/admin/ai/calls/${list.body.items[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.call.attempts[0]).toMatchObject({ model: 'mock-primary', status: 'success' });
    expect(detail.body.related.map((c: { feature: string }) => c.feature)).toEqual(expect.arrayContaining(['embed.query', 'tutor.answer']));
    expect(detail.body.message).toMatchObject({ id: messageId, question: 'How does backpropagation compute gradients?' });
    expect(detail.body.message.trace.retrieval).toHaveProperty('selected');
    expect(detail.body.message.sources[0]).toMatchObject({ materialTitle: 'Machine Learning Notes', cited: true });
  });

  it('summarises evaluation results from rules, feedback and the judge', async () => {
    await vi.waitFor(async () => expect(await AiEvaluation.countDocuments({ evaluator: 'rules' })).toBe(1));
    await learner.post(`/api/projects/${projectId}/tutor/messages/${messageId}/feedback`).set(XRW).send({ rating: 'down', reason: 'unclear' });
    await drainJobs({ types: ['ai.evaluate'] });

    const overview = await admin.get('/api/admin/ai/evaluations/overview?range=7d');
    expect(overview.status).toBe(200);
    const byEvaluator = Object.fromEntries(overview.body.evaluators.map((e: { evaluator: string; total: number }) => [e.evaluator, e.total]));
    expect(byEvaluator).toMatchObject({ rules: 1, llm_judge: 1, learner_feedback: 1 });
    expect(overview.body.judge.groundedness).toBe(1);
    expect(overview.body.byPromptVersion[0]).toMatchObject({ promptVersion: 'tutor.v2', samples: 1 });
    expect(overview.body.groundingDistribution).toEqual([{ status: 'grounded', count: 1 }]);

    const failures = await admin.get('/api/admin/ai/evaluations?verdict=fail');
    expect(failures.body.items[0]).toMatchObject({ evaluator: 'learner_feedback', flags: ['unclear'] });

    const configuration = await admin.get('/api/admin/ai/config');
    expect(configuration.body.promptVersions).toMatchObject({ tutor: 'tutor.v2', tutorJudge: 'judge.tutor.v1' });
    expect(configuration.body.tools.map((t: { name: string }) => t.name)).toContain('search_materials');
  });

  it('shows the queue and lets an operator retry a dead-lettered job (audited)', async () => {
    registerJobHandler('test.always_fails', async () => {
      throw new JobError('BROKEN', 'always fails');
    });
    const { job } = await enqueueJob({ type: 'test.always_fails', idempotencyKey: 'broken:1', maxAttempts: 1 });
    await drainJobs({ types: ['test.always_fails'] });

    const overview = await admin.get('/api/admin/jobs/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.byType.find((t: { type: string }) => t.type === 'test.always_fails')).toMatchObject({ failed: 1 });
    expect(overview.body.recentFailures[0]).toMatchObject({ id: job._id.toString(), lastError: { code: 'BROKEN' } });

    const failed = await admin.get('/api/admin/jobs?status=failed');
    expect(failed.body.items.some((j: { id: string }) => j.id === job._id.toString())).toBe(true);
    const detail = await admin.get(`/api/admin/jobs/${job._id}`);
    expect(detail.body.job.errorHistory).toHaveLength(1);

    const retry = await admin.post(`/api/admin/jobs/${job._id}/retry`).set(XRW);
    expect(retry.status).toBe(200);
    expect(retry.body.job).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await AuditLog.countDocuments({ action: 'admin.job.retried' })).toBe(1);
    const again = await admin.post(`/api/admin/jobs/${job._id}/retry`).set(XRW);
    expect(again.status).toBe(409);
  });

  it("includes a learner's AI usage and tutor activity in their profile", async () => {
    const res = await admin.get(`/api/admin/users/${learnerId}`);
    expect(res.body.aiUsage).toMatchObject({ tutorAnswers: 1, grounding: { grounded: 1 } });
    expect(res.body.aiUsage.calls).toBeGreaterThanOrEqual(2);
    expect(res.body.stats).toMatchObject({ conversationCount: 1 });
  });

  it('reports worker, queue, AI gateway and retrieval health', async () => {
    const res = await admin.get('/api/admin/system/health');
    expect(res.status).toBe(200);
    expect(res.body.worker).toMatchObject({ status: 'down', alive: 0 });
    expect(res.body.ai).toMatchObject({ provider: 'mock' });
    expect(res.body.retrieval.chunks).toBe(3);
  });

  it('keeps every AI admin endpoint behind the admin role', async () => {
    for (const path of ['/api/admin/ai/overview', '/api/admin/ai/calls', '/api/admin/ai/evaluations/overview', '/api/admin/jobs/overview', '/api/admin/ai/config']) {
      expect((await learner.get(path)).status, path).toBe(403);
    }
  });
});
