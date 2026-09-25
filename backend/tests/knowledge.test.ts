import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIError } from '../src/ai/errors';
import type { MockAIProvider } from '../src/ai/mock';
import { drainJobs } from '../src/jobs/worker';
import { ActivityEvent } from '../src/models/activityEvent.model';
import { Chunk, Concept, MaterialPage } from '../src/models/knowledge.model';
import { Job } from '../src/models/job.model';
import { retrieve } from '../src/modules/knowledge/retrieval';
import { installMockAI, makeTextPdf, ML_PAGES, seedKnowledge } from './ai-helpers';
import { createProject, createSpace, makePdf, registerLearner, uploadPdf, useTestDatabase, XRW, type Agent } from './helpers';

useTestDatabase();

describe('material processing pipeline', () => {
  let agent: Agent;
  let userId: string;
  let projectId: string;
  let provider: MockAIProvider;

  beforeEach(async () => {
    provider = installMockAI();
    let user;
    ({ agent, user } = await registerLearner());
    userId = user.id;
    const space = await createSpace(agent);
    projectId = (await createProject(agent, space.id)).id;
  });

  const material = async (id: string) => (await agent.get(`/api/projects/${projectId}/materials/${id}`)).body.material;

  it('upload → queued → background processing → ready with pages, chunks, embeddings and concepts', async () => {
    const pdf = await makeTextPdf(ML_PAGES);
    const upload = await uploadPdf(agent, projectId, { buffer: pdf, filename: 'ml-notes.pdf', title: 'Machine Learning Notes' });
    expect(upload.status).toBe(201);
    expect(upload.body.material.status).toBe('queued');
    const id = upload.body.material.id;

    // The upload event enqueued exactly one idempotent job; the request itself did no heavy work.
    const jobs = await Job.find({ type: 'material.process' }).lean();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ idempotencyKey: `material.process:${id}:v1`, status: 'queued' });

    expect(await drainJobs()).toMatchObject({ failed: 0 });
    const ready = await material(id);
    expect(ready).toMatchObject({
      status: 'ready',
      pageCount: 3,
      processing: { stage: 'done', progress: 100, error: null },
      summary: 'Notes on how neural networks learn.',
      stats: { conceptCount: 2 },
    });
    expect(ready.stats.chunkCount).toBeGreaterThan(0);

    const pages = await MaterialPage.find({ materialId: id }).sort({ pageNumber: 1 }).lean();
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0].text).toContain('Backpropagation computes gradients');

    const chunks = await Chunk.find({ materialId: id }).select('+embedding').lean();
    expect(chunks.every((c) => c.embedding.length === 768 && c.pageStart >= 1 && c.pageEnd <= 3)).toBe(true);

    const concepts = await agent.get(`/api/projects/${projectId}/concepts`);
    expect(concepts.body.items.map((c: { name: string }) => c.name)).toEqual(['Backpropagation', 'Gradient Descent']);
    expect(concepts.body.items[0].sources[0]).toMatchObject({ materialTitle: 'Machine Learning Notes', pages: [1] });

    // Citations can be opened: the page text is served per page, owner-only.
    const page = await agent.get(`/api/projects/${projectId}/materials/${id}/pages/2`);
    expect(page.body.page).toMatchObject({ pageNumber: 2, materialTitle: 'Machine Learning Notes', method: 'text' });
    const intruder = await registerLearner();
    expect((await intruder.agent.get(`/api/projects/${projectId}/materials/${id}/pages/2`)).status).toBe(404);

    const processed = await ActivityEvent.findOne({ type: 'material.processed' }).lean();
    expect(processed?.metadata).toMatchObject({ materialTitle: 'Machine Learning Notes', pageCount: 3, conceptCount: 2 });
  });

  it('fails a corrupt PDF permanently with a learner-friendly reason, and allows a retry', async () => {
    const upload = await uploadPdf(agent, projectId, { buffer: makePdf(), filename: 'empty.pdf' });
    const id = upload.body.material.id;
    await drainJobs();
    const failed = await material(id);
    expect(failed.status).toBe('failed');
    expect(failed.processing.error).toMatchObject({ code: 'NO_EXTRACTABLE_TEXT', retryable: false });
    expect(failed.processing.error.message).toMatch(/No readable text/);
    expect(await ActivityEvent.countDocuments({ type: 'material.failed' })).toBe(1);

    const retry = await agent.post(`/api/projects/${projectId}/materials/${id}/retry`).set(XRW);
    expect(retry.status).toBe(202);
    expect(retry.body.material.status).toBe('queued');
    expect(await Job.countDocuments({ type: 'material.process' })).toBe(2); // new version → new idempotency key
    const notFailed = await agent.post(`/api/projects/${projectId}/materials/${id}/retry`).set(XRW);
    expect(notFailed.status).toBe(409);
  });

  it('retries transient AI failures and resumes from the last completed stage', async () => {
    provider.failures.set('mock-light', new AIError('unavailable', 'overloaded', { status: 503 }));
    const upload = await uploadPdf(agent, projectId, { buffer: await makeTextPdf(ML_PAGES), filename: 'ml.pdf' });
    const id = upload.body.material.id;
    await drainJobs();

    let current = await material(id);
    expect(current.status).toBe('queued'); // waiting to retry, not failed
    expect(current.processing.stage).toBe('waiting-to-retry');
    const job = (await Job.findOne({ type: 'material.process' }).lean())!;
    expect(job).toMatchObject({ status: 'queued', attempts: 1, lastError: { code: 'AI_UNAVAILABLE' } });
    const embedCallsBefore = provider.calls.filter((c) => c.kind === 'embed').length;

    provider.failures.clear();
    await Job.updateOne({ _id: job._id }, { $set: { runAt: new Date() } });
    await drainJobs();
    current = await material(id);
    expect(current.status).toBe('ready');
    // Chunk embeddings were checkpointed on the first attempt: the retry did not pay for them again.
    const documentEmbeds = provider.calls.slice(embedCallsBefore).filter((c) => c.kind === 'embed' && c.texts!.some((t) => t.includes('Backpropagation computes')));
    expect(documentEmbeds).toHaveLength(0);
  });

  it('removes derived knowledge when a material is deleted', async () => {
    const upload = await uploadPdf(agent, projectId, { buffer: await makeTextPdf(ML_PAGES), filename: 'ml.pdf' });
    await drainJobs();
    const id = upload.body.material.id;
    expect(await Chunk.countDocuments({ materialId: id })).toBeGreaterThan(0);
    const res = await agent.delete(`/api/projects/${projectId}/materials/${id}`).set(XRW);
    expect(res.status).toBe(204);
    expect(await Chunk.countDocuments({ materialId: id })).toBe(0);
    expect(await MaterialPage.countDocuments({ materialId: id })).toBe(0);
    expect(await Concept.countDocuments({})).toBe(0);
  });

  it('removes every derived artefact when the Project is deleted', async () => {
    await seedKnowledge(projectId);
    const res = await agent.delete(`/api/projects/${projectId}`).set(XRW);
    expect(res.status).toBe(204);
    expect(await Chunk.countDocuments({})).toBe(0);
    expect(await Concept.countDocuments({})).toBe(0);
    expect(await MaterialPage.countDocuments({})).toBe(0);
  });

  describe('retrieval', () => {
    it('ranks relevant evidence, reports sufficiency and never crosses Project boundaries', async () => {
      await seedKnowledge(projectId);
      const other = await registerLearner();
      const otherSpace = await createSpace(other.agent);
      const otherProject = await createProject(other.agent, otherSpace.id);
      await seedKnowledge(otherProject.id, { pages: ['Gradient descent learning rate overshoot in the other learner project.'] });

      const result = await retrieve({ ownerId: userId, projectId, query: 'What happens with a large learning rate in gradient descent?' });
      expect(result.sufficiency).toBe('strong');
      expect(result.sources[0]).toMatchObject({ pageStart: 2, materialTitle: 'Machine Learning Notes' });
      expect(result.sources.every((s) => !s.text.includes('other learner'))).toBe(true);
      expect(result.trace).toMatchObject({ method: 'memory', sufficiency: 'strong' });

      const unrelated = await retrieve({ ownerId: userId, projectId, query: 'Who painted the Mona Lisa?' });
      expect(unrelated.sufficiency).toBe('none');

      // Wrong owner for the Project → nothing, even with a matching query.
      const crossed = await retrieve({ ownerId: other.user.id, projectId, query: 'gradient descent learning rate' });
      expect(crossed.sources).toHaveLength(0);
    });
  });

  it('reconciles a queued material whose job was lost', async () => {
    const upload = await uploadPdf(agent, projectId, { buffer: await makeTextPdf(ML_PAGES), filename: 'ml.pdf' });
    await Job.deleteMany({});
    // Pretend the upload happened a while ago.
    const { Material } = await import('../src/models/material.model');
    await Material.collection.updateOne({ _id: new (await import('mongoose')).Types.ObjectId(upload.body.material.id) }, { $set: { updatedAt: new Date(Date.now() - 120_000) } });
    const { reconcileMaterials } = await import('../src/modules/knowledge/knowledge.service');
    expect(await reconcileMaterials()).toEqual({ requeued: 1 });
    await drainJobs();
    await vi.waitFor(async () => expect((await material(upload.body.material.id)).status).toBe('ready'));
  });
});
