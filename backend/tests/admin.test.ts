import { WorkerHeartbeat } from '../src/models/job.model';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/models/auditLog.model';
import {
  binaryParser,
  createProject,
  createSpace,
  loginAsNewAdmin,
  registerLearner,
  uploadPdf,
  useTestDatabase,
  type Agent,
} from './helpers';

useTestDatabase();

describe('admin console API', () => {
  let admin: Agent;
  let alice: { id: string };
  let bob: { id: string };
  let aliceSpace: { id: string };
  let aliceProject: { id: string };
  let aliceMaterial: { id: string };

  beforeEach(async () => {
    const a = await registerLearner({ name: 'Alice Admire', email: 'alice@example.com' });
    const b = await registerLearner({ name: 'Bob Builder', email: 'bob@example.com' });
    alice = a.user;
    bob = b.user;
    aliceSpace = await createSpace(a.agent, { name: 'Physics' });
    aliceProject = await createProject(a.agent, aliceSpace.id, { name: 'Quantum' });
    aliceMaterial = (await uploadPdf(a.agent, aliceProject.id)).body.material;
    const bobSpace = await createSpace(b.agent, { name: 'History' });
    await createProject(b.agent, bobSpace.id, { name: 'Rome' });
    admin = await loginAsNewAdmin();
  });

  it('summarises the platform on the overview', async () => {
    const res = await admin.get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({
      learners: 2,
      admins: 1,
      newLearners7d: 2,
      spaces: 2,
      projects: 2,
      materials: 1,
      materialsByStatus: { queued: 1, processing: 0, ready: 0, failed: 0 },
    });
    expect(res.body.activitySeries).toHaveLength(14);
    const today = res.body.activitySeries.at(-1);
    expect(today.signups).toBe(2);
    expect(today.events).toBeGreaterThan(0);
    expect(res.body.recentActivity[0].user).toHaveProperty('email');
  });

  it('lists and searches users with per-user counts', async () => {
    const all = await admin.get('/api/admin/users?role=user');
    expect(all.body.total).toBe(2);
    const found = await admin.get('/api/admin/users?search=admire');
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({ id: alice.id, counts: { spaces: 1, projects: 1, materials: 1 } });
    expect(found.body.items[0]).not.toHaveProperty('passwordHash');
  });

  it("shows a learner's journey", async () => {
    const res = await admin.get(`/api/admin/users/${alice.id}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ spaceCount: 1, projectCount: 1, materialCount: 1 });
    expect(res.body.spaces[0]).toMatchObject({ name: 'Physics', projects: [{ name: 'Quantum', materialCount: 1 }] });
    expect(res.body.materials[0]).toMatchObject({ id: aliceMaterial.id, projectName: 'Quantum' });
    expect(res.body.recentActivity.length).toBeGreaterThan(0);
    expect((await admin.get('/api/admin/users/64b000000000000000000000')).status).toBe(404);
  });

  it('filters Spaces, Projects and materials across tenants', async () => {
    const spaces = await admin.get(`/api/admin/spaces?userId=${bob.id}`);
    expect(spaces.body.items.map((s: { name: string }) => s.name)).toEqual(['History']);
    expect(spaces.body.items[0].owner).toMatchObject({ id: bob.id, name: 'Bob Builder' });

    const projects = await admin.get(`/api/admin/projects?spaceId=${aliceSpace.id}`);
    expect(projects.body.items).toHaveLength(1);
    expect(projects.body.items[0]).toMatchObject({ name: 'Quantum', space: { name: 'Physics' } });

    const materials = await admin.get('/api/admin/materials?status=queued');
    expect(materials.body.items[0]).toMatchObject({ project: { name: 'Quantum' }, space: { name: 'Physics' } });
    expect((await admin.get('/api/admin/materials?status=ready')).body.total).toBe(0);

    // Blank filters mean "no filter", not a validation error.
    expect((await admin.get('/api/admin/projects?userId=&spaceId=&search=')).body.total).toBe(2);
  });

  it('filters platform activity by user, type and time period', async () => {
    const byUser = await admin.get(`/api/admin/activity?userId=${bob.id}`);
    expect(byUser.body.items.every((e: { ownerId: string }) => e.ownerId === bob.id)).toBe(true);

    const uploads = await admin.get('/api/admin/activity?type=material.uploaded');
    expect(uploads.body.total).toBe(1);
    expect(uploads.body.items[0]).toMatchObject({ projectId: aliceProject.id, user: { id: alice.id } });

    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await admin.get(`/api/admin/activity?from=${future}`)).body.total).toBe(0);
    expect((await admin.get('/api/admin/activity?type=not.a.type')).status).toBe(400);

    const types = await admin.get('/api/admin/activity/types');
    expect(types.body.items).toContain('material.uploaded');
  });

  it('lets an admin view a learner PDF and audit-logs the access', async () => {
    const res = await admin.get(`/api/admin/materials/${aliceMaterial.id}/file`).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const audit = await AuditLog.findOne({ action: 'admin.material.viewed' }).lean();
    expect(audit?.ownerId?.toString()).toBe(alice.id);
  });

  it('reports system health, degraded while no background worker is alive', async () => {
    const down = await admin.get('/api/admin/system/health');
    expect(down.status).toBe(200);
    expect(down.body).toMatchObject({ status: 'degraded', database: { status: 'up' }, storage: { files: 1 }, worker: { status: 'down' } });

    await WorkerHeartbeat.create({ _id: 'test-worker', host: 'test', pid: 1, role: 'worker', version: 'test', startedAt: new Date(), lastBeatAt: new Date(), concurrency: 2, running: 0, processed: 0, failed: 0 });
    const up = await admin.get('/api/admin/system/health');
    expect(up.body).toMatchObject({ status: 'ok', worker: { status: 'up', alive: 1 } });
  });
});
