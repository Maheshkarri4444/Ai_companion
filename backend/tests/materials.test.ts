import mongoose from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityEvent } from '../src/models/activityEvent.model';
import {
  binaryParser,
  createProject,
  createSpace,
  makePdf,
  registerLearner,
  uploadPdf,
  useTestDatabase,
  XRW,
  type Agent,
} from './helpers';

useTestDatabase();

describe('material upload', () => {
  let agent: Agent;
  let projectId: string;

  beforeEach(async () => {
    ({ agent } = await registerLearner());
    const space = await createSpace(agent);
    projectId = (await createProject(agent, space.id)).id;
  });

  it('accepts a PDF, queues it for processing and records the event', async () => {
    const pdf = makePdf();
    const res = await uploadPdf(agent, projectId, { buffer: pdf, filename: 'machine_learning-notes.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.material).toMatchObject({
      projectId,
      title: 'machine learning-notes',
      originalFilename: 'machine_learning-notes.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      status: 'queued',
      pageCount: null,
    });
    expect(res.body.material).not.toHaveProperty('sha256');
    expect(res.body.material).not.toHaveProperty('storage');

    const event = await ActivityEvent.findOne({ type: 'material.uploaded' }).lean();
    expect(event?.metadata).toMatchObject({ materialTitle: 'machine learning-notes', projectName: 'Neural Networks' });
  });

  it('uses a provided title and keeps non-ASCII filenames intact', async () => {
    const res = await uploadPdf(agent, projectId, { filename: 'Résumé – Lineare Algebra.pdf', title: 'Linear Algebra' });
    expect(res.status).toBe(201);
    expect(res.body.material).toMatchObject({ title: 'Linear Algebra', originalFilename: 'Résumé – Lineare Algebra.pdf' });
  });

  it('streams back the exact bytes inline as application/pdf', async () => {
    const pdf = makePdf();
    const material = (await uploadPdf(agent, projectId, { buffer: pdf })).body.material;
    const res = await agent
      .get(`/api/projects/${projectId}/materials/${material.id}/file`)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, pdf)).toBe(0);
  });

  it.each([
    ['a text file', { buffer: Buffer.from('hello'), filename: 'notes.txt', contentType: 'text/plain' }],
    ['a renamed non-PDF', { buffer: Buffer.from('MZ fake executable'), filename: 'notes.pdf' }],
    ['a PDF with the wrong extension', { buffer: makePdf(), filename: 'notes.exe', contentType: 'application/pdf' }],
  ])('rejects %s with 415', async (_label, options) => {
    const res = await uploadPdf(agent, projectId, options);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects empty, missing and oversized files', async () => {
    const empty = await uploadPdf(agent, projectId, { buffer: Buffer.alloc(0) });
    expect(empty.status).toBe(400);

    const missing = await agent.post(`/api/projects/${projectId}/materials`).set(XRW).field('title', 'no file');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('FILE_REQUIRED');

    const big = Buffer.concat([makePdf(), Buffer.alloc(1024 * 1024 + 10, 0x20)]); // tests run with MAX_UPLOAD_MB=1
    const oversized = await uploadPdf(agent, projectId, { buffer: big });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses the same file twice in a Project but allows it in another', async () => {
    const pdf = makePdf('same-bytes');
    const first = await uploadPdf(agent, projectId, { buffer: pdf });
    const again = await uploadPdf(agent, projectId, { buffer: pdf, filename: 'renamed.pdf' });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DUPLICATE_MATERIAL', details: { materialId: first.body.material.id } });
    expect(await mongoose.connection.db!.collection('material_files.files').countDocuments()).toBe(1);

    const space = await createSpace(agent, { name: 'Other' });
    const otherProject = await createProject(agent, space.id);
    expect((await uploadPdf(agent, otherProject.id, { buffer: pdf })).status).toBe(201);
  });

  it('renames and deletes a material (including its stored file)', async () => {
    const material = (await uploadPdf(agent, projectId)).body.material;
    const base = `/api/projects/${projectId}/materials/${material.id}`;

    const renamed = await agent.patch(base).set(XRW).send({ title: 'Week 1 slides' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.material.title).toBe('Week 1 slides');

    expect((await agent.delete(base).set(XRW)).status).toBe(204);
    expect((await agent.get(base)).status).toBe(404);
    expect(await mongoose.connection.db!.collection('material_files.files').countDocuments()).toBe(0);
    expect((await agent.get(`/api/projects/${projectId}/materials`)).body.items).toEqual([]);
  });
});
