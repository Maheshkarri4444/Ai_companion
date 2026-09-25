import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  app,
  binaryParser,
  createProject,
  createSpace,
  registerLearner,
  uploadPdf,
  useTestDatabase,
  XRW,
  type Agent,
} from './helpers';

useTestDatabase();

/**
 * Users must only reach their own Spaces, Projects and materials (PRD §15). Foreign ids answer 404,
 * exactly like missing ones, so resource ids cannot be probed.
 */
describe('tenant isolation', () => {
  let alice: Agent;
  let bob: Agent;
  let aliceSpace: { id: string };
  let aliceProject: { id: string };
  let aliceMaterial: { id: string };
  let bobProject: { id: string };

  beforeEach(async () => {
    ({ agent: alice } = await registerLearner({ name: 'Alice' }));
    ({ agent: bob } = await registerLearner({ name: 'Bob' }));
    aliceSpace = await createSpace(alice, { name: 'Alice space' });
    aliceProject = await createProject(alice, aliceSpace.id, { name: 'Alice project' });
    aliceMaterial = (await uploadPdf(alice, aliceProject.id)).body.material;
    const bobSpace = await createSpace(bob, { name: 'Bob space' });
    bobProject = await createProject(bob, bobSpace.id, { name: 'Bob project' });
  });

  it("hides another user's Space (read, update, delete, nested routes)", async () => {
    const base = `/api/spaces/${aliceSpace.id}`;
    const responses = await Promise.all([
      bob.get(base),
      bob.patch(base).set(XRW).send({ name: 'hijacked' }),
      bob.delete(base).set(XRW),
      bob.get(`${base}/projects`),
      bob.post(`${base}/projects`).set(XRW).send({ name: 'x', description: 'x', learningGoal: 'x' }),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await alice.get(base)).body.space.name).toBe('Alice space');
  });

  it("hides another user's Project and its materials", async () => {
    const base = `/api/projects/${aliceProject.id}`;
    const responses = await Promise.all([
      bob.get(base),
      bob.patch(base).set(XRW).send({ name: 'hijacked' }),
      bob.delete(base).set(XRW),
      bob.get(`${base}/materials`),
      bob.get(`${base}/materials/${aliceMaterial.id}`),
      bob.get(`${base}/materials/${aliceMaterial.id}/file`),
      bob.patch(`${base}/materials/${aliceMaterial.id}`).set(XRW).send({ title: 'hijacked' }),
      bob.delete(`${base}/materials/${aliceMaterial.id}`).set(XRW),
    ]);
    for (const res of responses) expect(res.status).toBe(404);
  });

  it("rejects uploads into another user's Project", async () => {
    const res = await uploadPdf(bob, aliceProject.id);
    expect(res.status).toBe(404);
    expect((await alice.get(`/api/projects/${aliceProject.id}/materials`)).body.items).toHaveLength(1);
  });

  it('does not let a material be addressed through a different (own) Project', async () => {
    const res = await bob.get(`/api/projects/${bobProject.id}/materials/${aliceMaterial.id}/file`);
    expect(res.status).toBe(404);
  });

  it('keeps lists, dashboards and activity feeds scoped to the caller', async () => {
    const spaces = await bob.get('/api/spaces');
    expect(spaces.body.items.map((s: { name: string }) => s.name)).toEqual(['Bob space']);

    const recent = await bob.get('/api/projects/recent');
    expect(recent.body.items.map((p: { name: string }) => p.name)).toEqual(['Bob project']);

    const snooping = await bob.get(`/api/activity?projectId=${aliceProject.id}`);
    expect(snooping.status).toBe(200);
    expect(snooping.body.items).toEqual([]);

    const dashboard = await bob.get('/api/dashboard');
    expect(dashboard.body.stats).toMatchObject({ spaceCount: 1, projectCount: 1, materialCount: 0 });
  });

  it('still serves the owner their own file', async () => {
    const res = await alice
      .get(`/api/projects/${aliceProject.id}/materials/${aliceMaterial.id}/file`)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});

describe('role-based access', () => {
  it('requires authentication for workspace routes', async () => {
    for (const path of ['/api/spaces', '/api/dashboard', '/api/projects/recent', '/api/activity']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('forbids learners from the admin API', async () => {
    const { agent } = await registerLearner();
    for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/activity', '/api/admin/system/health']) {
      const res = await agent.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});
