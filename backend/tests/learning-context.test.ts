import { beforeEach, describe, expect, it } from 'vitest';
import { LearningContext } from '../src/models/learningContext.model';
import {
  forgetLearning,
  listLearningContext,
  recallLearning,
  rememberLearning,
  resolveLearning,
} from '../src/modules/learning-context/learning-context.service';
import { composeContext, registerContextProvider } from '../src/modules/learning-context/providers';
import { installMockAI, seedKnowledge } from './ai-helpers';
import { createProject, createSpace, registerLearner, useTestDatabase } from './helpers';

useTestDatabase();

describe('persistent learning context', () => {
  let userId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeEach(async () => {
    installMockAI();
    const { agent, user } = await registerLearner();
    userId = user.id;
    const space = await createSpace(agent);
    projectId = (await createProject(agent, space.id)).id;
    otherProjectId = (await createProject(agent, space.id, { name: 'Linear Algebra' })).id;
  });

  const remember = (items: Parameters<typeof rememberLearning>[0]['items'], project = projectId) =>
    rememberLearning({ ownerId: userId, projectId: project, items, source: { type: 'tutor' } });

  it('reinforces near-duplicates instead of storing them twice', async () => {
    expect(await remember([{ kind: 'weakness', content: 'Struggles with the chain rule in backpropagation' }])).toEqual({ created: 1, reinforced: 0 });
    expect(await remember([{ kind: 'weakness', content: 'struggles with the chain rule in backpropagation' }])).toEqual({ created: 0, reinforced: 1 });
    const [item] = await listLearningContext(userId, projectId);
    expect(item).toMatchObject({ kind: 'weakness', evidenceCount: 2 });
    expect(item.salience).toBeGreaterThan(0.7);
  });

  it('recalls only what is relevant to the current request, always including goals and preferences', async () => {
    await remember([
      { kind: 'goal', content: 'Pass the machine learning exam in October' },
      { kind: 'preference', content: 'Prefers short answers with one worked example' },
      { kind: 'misconception', content: 'Thinks a larger learning rate always trains faster' },
      { kind: 'interest', content: 'Enjoys computer vision applications and image datasets' },
    ]);
    const recalled = await recallLearning({ ownerId: userId, projectId, query: 'why does a large learning rate diverge', limit: 4 });
    const kinds = recalled.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['goal', 'preference', 'misconception']));
    expect(kinds).not.toContain('interest'); // unrelated to this request
  });

  it('keeps Projects isolated, except user-wide preferences', async () => {
    await remember([{ kind: 'weakness', content: 'Confuses eigenvalues and eigenvectors' }], otherProjectId);
    await remember([{ kind: 'preference', content: 'Prefers analogies before formulas', scope: 'user' }], otherProjectId);
    const items = await listLearningContext(userId, projectId);
    expect(items.map((i) => i.content)).toEqual(['Prefers analogies before formulas']);
  });

  it('bounds the active set and lets the learner resolve or forget items', async () => {
    await remember(Array.from({ length: 10 }, (_, i) => ({ kind: 'note' as const, content: `Observation number ${i} about topic ${i * 7}` })));
    for (let batch = 0; batch < 6; batch++) {
      await remember(Array.from({ length: 10 }, (_, i) => ({ kind: 'note' as const, content: `Batch ${batch} unique remark ${i} regarding ${batch}-${i}` })));
    }
    expect(await LearningContext.countDocuments({ status: 'active', projectId })).toBeLessThanOrEqual(60);

    const [first] = await listLearningContext(userId, projectId);
    await forgetLearning(userId, projectId, first.id);
    expect(await LearningContext.exists({ _id: first.id })).toBeNull();

    await remember([{ kind: 'weakness', content: 'Unsure how dropout works' }]);
    expect(await resolveLearning({ ownerId: userId, projectId, kinds: ['weakness'] })).toBe(1);
    expect((await recallLearning({ ownerId: userId, projectId, query: 'dropout' })).some((i) => i.kind === 'weakness')).toBe(false);
  });
});

describe('context composition', () => {
  it('composes Project profile + learner memory within budget, and picks up providers registered later', async () => {
    installMockAI();
    const { agent, user } = await registerLearner();
    const space = await createSpace(agent);
    const projectId = (await createProject(agent, space.id)).id;
    await seedKnowledge(projectId);
    await rememberLearning({ ownerId: user.id, projectId, items: [{ kind: 'goal', content: 'Build a neural network from scratch' }], source: { type: 'learner' } });

    // A later phase (e.g. mastery) plugs in without changing any AI feature.
    registerContextProvider({
      id: 'mastery_test',
      priority: 95,
      load: async () => ({ id: 'mastery_test', title: 'Concept mastery', lines: ['Backpropagation: 42% (needs attention)'] }),
    });
    registerContextProvider({ id: 'broken_test', priority: 10, load: async () => Promise.reject(new Error('boom')) });

    const context = await composeContext({ ownerId: user.id, projectId, query: 'backpropagation', purpose: 'tutor' });
    expect(context.text).toContain('Learning goal: Explain and implement backpropagation');
    expect(context.text).toContain('Key concepts: Backpropagation, Gradient Descent');
    expect(context.text).toContain('Build a neural network from scratch');
    expect(context.text).toContain('Backpropagation: 42% (needs attention)');
    expect(context.trace.find((t) => t.id === 'broken_test')?.status).toBe('error');

    const tiny = await composeContext({ ownerId: user.id, projectId, query: 'x', purpose: 'tutor' }, { budgetChars: 120 });
    expect(tiny.trace.some((t) => t.status === 'dropped')).toBe(true);
  });
});
