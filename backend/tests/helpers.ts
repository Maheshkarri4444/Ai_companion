import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, inject } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/models/user.model';

export const app = createApp();

/** Required on every state-changing request (CSRF guard). */
export const XRW = { 'X-Requested-With': 'fetch' } as const;

export type Agent = ReturnType<typeof request.agent>;

/** Connects this test file to its own database on the shared in-memory server and cleans between tests. */
export function useTestDatabase() {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}` });
    // Unique indexes (email, duplicate-upload guard, event keys) must exist before tests rely on them.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

const unique = () => randomUUID().slice(0, 8);

export async function registerLearner(overrides: Partial<{ name: string; email: string; password: string }> = {}) {
  const agent = request.agent(app);
  const credentials = {
    name: 'Test Learner',
    email: `learner_${unique()}@example.com`,
    password: 'Password123',
    ...overrides,
  };
  const res = await agent.post('/api/auth/register').set(XRW).send(credentials);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { agent, user: res.body.user as { id: string; email: string; role: string }, credentials };
}

export async function loginAsNewAdmin() {
  const email = `admin_${unique()}@example.com`;
  const password = 'AdminPass123';
  await User.create({ name: 'Test Admin', email, passwordHash: await bcrypt.hash(password, 4), role: 'admin' });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(XRW).send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

export async function createSpace(agent: Agent, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post('/api/spaces')
    .set(XRW)
    .send({ name: 'Machine Learning', description: 'Core ML concepts', ...overrides });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.space as { id: string; name: string; color: string; icon: string };
}

export async function createProject(agent: Agent, spaceId: string, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post(`/api/spaces/${spaceId}/projects`)
    .set(XRW)
    .send({
      name: 'Neural Networks',
      description: 'Backpropagation and friends',
      learningGoal: 'Explain and implement backpropagation',
      ...overrides,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.project as { id: string; spaceId: string; name: string };
}

/** A minimal, structurally valid one-page PDF; `marker` makes the bytes (and hash) unique. */
export function makePdf(marker = unique()): Buffer {
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>> endobj',
      'trailer <</Root 1 0 R>>',
      `%${marker}`,
      '%%EOF',
      '',
    ].join('\n'),
    'latin1',
  );
}

export async function uploadPdf(
  agent: Agent,
  projectId: string,
  options: { buffer?: Buffer; filename?: string; title?: string; contentType?: string } = {},
) {
  const req = agent.post(`/api/projects/${projectId}/materials`).set(XRW);
  if (options.title) req.field('title', options.title);
  return req.attach('file', options.buffer ?? makePdf(), {
    filename: options.filename ?? 'lecture-notes.pdf',
    contentType: options.contentType ?? 'application/pdf',
  });
}

/** Superagent does not buffer application/pdf bodies by default; collect them into a Buffer. */
export function binaryParser(res: EventEmitter, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (err: Error) => cb(err, Buffer.alloc(0)));
}
