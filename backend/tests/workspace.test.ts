import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ActivityEvent } from '../src/models/activityEvent.model';
import { Material } from '../src/models/material.model';
import { Project } from '../src/models/project.model';
import { createProject, createSpace, registerLearner, uploadPdf, useTestDatabase, XRW } from './helpers';

useTestDatabase();

describe('Spaces', () => {
  it('creates a Space with default visuals and lists it with counts', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    expect(space).toMatchObject({ name: 'Machine Learning', color: 'blue', icon: 'book' });

    const project = await createProject(agent, space.id);
    await uploadPdf(agent, project.id);

    const list = await agent.get('/api/spaces');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ id: space.id, projectCount: 1, materialCount: 1 });
  });

  it.each([
    [{ description: 'no name' }, 'name'],
    [{ name: 'No description' }, 'description'],
    [{ name: 'x', description: 'y', color: 'neon' }, 'color'],
    [{ name: 'x', description: 'y', icon: '<script>' }, 'icon'],
    [{ name: 'x'.repeat(81), description: 'y' }, 'name'],
  ])('validates input %j', async (body, field) => {
    const { agent } = await registerLearner();
    const res = await agent.post('/api/spaces').set(XRW).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
  });

  it('applies partial updates without resetting omitted fields', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent, { color: 'violet', icon: 'brain' });
    const res = await agent.patch(`/api/spaces/${space.id}`).set(XRW).send({ name: 'Deep Learning' });
    expect(res.status).toBe(200);
    expect(res.body.space).toMatchObject({ name: 'Deep Learning', color: 'violet', icon: 'brain' });

    const empty = await agent.patch(`/api/spaces/${space.id}`).set(XRW).send({});
    expect(empty.status).toBe(400);
  });

  it('rejects malformed ids with 400', async () => {
    const { agent } = await registerLearner();
    expect((await agent.get('/api/spaces/not-an-id')).status).toBe(400);
  });

  it('returns a Space dashboard with projects, stats and activity', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const project = await createProject(agent, space.id);
    await uploadPdf(agent, project.id);

    const res = await agent.get(`/api/spaces/${space.id}`);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ projectCount: 1, materialCount: 1 });
    expect(res.body.projects[0]).toMatchObject({ id: project.id, materialCount: 1 });
    expect(res.body.recentActivity.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['space.created', 'project.created', 'material.uploaded']),
    );
  });

  it('deletes a Space with all its Projects, materials and stored files', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const project = await createProject(agent, space.id);
    await uploadPdf(agent, project.id);
    const db = mongoose.connection.db!;
    expect(await db.collection('material_files.files').countDocuments()).toBe(1);

    const res = await agent.delete(`/api/spaces/${space.id}`).set(XRW);
    expect(res.status).toBe(204);
    expect(await Project.countDocuments({ spaceId: space.id })).toBe(0);
    expect(await Material.countDocuments({ projectId: project.id })).toBe(0);
    expect(await db.collection('material_files.files').countDocuments()).toBe(0);
    expect(await db.collection('material_files.chunks').countDocuments()).toBe(0);

    const deleted = await ActivityEvent.findOne({ type: 'space.deleted' }).lean();
    expect(deleted?.metadata).toMatchObject({ spaceName: 'Machine Learning', projectCount: 1, materialCount: 1 });
  });
});

describe('Projects', () => {
  it('requires name, description and learning goal', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const res = await agent.post(`/api/spaces/${space.id}/projects`).set(XRW).send({ name: 'Only a name' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { path: string }) => d.path);
    expect(fields).toEqual(expect.arrayContaining(['description', 'learningGoal']));
  });

  it('returns a Project dashboard whose next step follows the material state', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const project = await createProject(agent, space.id);

    let res = await agent.get(`/api/projects/${project.id}`);
    expect(res.status).toBe(200);
    expect(res.body.space).toMatchObject({ id: space.id, name: 'Machine Learning' });
    expect(res.body.nextStep).toMatchObject({ kind: 'upload_material', projectId: project.id });

    await uploadPdf(agent, project.id);
    res = await agent.get(`/api/projects/${project.id}`);
    expect(res.body.stats.materialsByStatus.queued).toBe(1);
    expect(res.body.nextStep).toMatchObject({ kind: 'await_processing', pendingCount: 1 });
    expect(res.body.recentMaterials).toHaveLength(1);
  });

  it('orders recent Projects by latest activity', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const first = await createProject(agent, space.id, { name: 'First' });
    await createProject(agent, space.id, { name: 'Second' });
    await uploadPdf(agent, first.id); // activity bumps "First" back to the top

    const res = await agent.get('/api/projects/recent');
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['First', 'Second']);
    expect(res.body.items[0].space).toMatchObject({ id: space.id });
  });

  it('updates and deletes a Project', async () => {
    const { agent } = await registerLearner();
    const space = await createSpace(agent);
    const project = await createProject(agent, space.id);
    await uploadPdf(agent, project.id);

    const patched = await agent.patch(`/api/projects/${project.id}`).set(XRW).send({ learningGoal: 'Ship a CNN' });
    expect(patched.body.project).toMatchObject({ learningGoal: 'Ship a CNN', name: 'Neural Networks', materialCount: 1 });

    expect((await agent.delete(`/api/projects/${project.id}`).set(XRW)).status).toBe(204);
    expect((await agent.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect(await Material.countDocuments({ projectId: project.id })).toBe(0);
  });
});

describe('home dashboard', () => {
  it('walks the learner through the first steps', async () => {
    const { agent } = await registerLearner();
    const next = async () => (await agent.get('/api/dashboard')).body.nextStep;

    expect(await next()).toEqual({ kind: 'create_space' });
    const space = await createSpace(agent);
    expect(await next()).toMatchObject({ kind: 'create_project', spaceId: space.id });
    const project = await createProject(agent, space.id);
    expect(await next()).toMatchObject({ kind: 'upload_material', projectId: project.id });
    await uploadPdf(agent, project.id);
    expect(await next()).toMatchObject({ kind: 'await_processing', projectId: project.id });

    const dashboard = (await agent.get('/api/dashboard')).body;
    expect(dashboard.stats).toMatchObject({ spaceCount: 1, projectCount: 1, materialCount: 1 });
    expect(dashboard.continueLearning).toMatchObject({ id: project.id });
    // Sign-in noise is hidden from the learner timeline.
    expect(dashboard.recentActivity.map((e: { type: string }) => e.type)).not.toContain('user.logged_in');
  });
});
