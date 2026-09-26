import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MockAIProvider } from '../src/ai/mock';
import { drainJobs } from '../src/jobs/worker';
import { ActivityEvent } from '../src/models/activityEvent.model';
import { AiEvaluation } from '../src/models/aiEvaluation.model';
import { Concept } from '../src/models/knowledge.model';
import { Mastery, MasterySnapshot } from '../src/models/mastery.model';
import { Attempt } from '../src/models/quiz.model';
import { Recommendation } from '../src/models/recommendation.model';
import { streaks } from '../src/modules/analytics/analytics.service';
import { classifyGrowth, slope } from '../src/modules/growth/classify';
import { buildCandidates, rankCandidates, type LearnerState } from '../src/modules/recommendations/candidates';
import { installMockAI, seedKnowledge } from './ai-helpers';
import { createProject, createSpace, loginAsNewAdmin, registerLearner, useTestDatabase, XRW, type Agent } from './helpers';

useTestDatabase();

const DAY = 86_400_000;
const logit = (p: number) => Math.log(p / (1 - p));
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe('growth classification (pure)', () => {
  const base = { rawMastery: null, baseline: null, evidenceCount: 5, recentOutcomes: [1, 1, 1], snapshots: [] as number[] };

  it('flags low, declining, error-prone and forgotten concepts for attention', () => {
    expect(classifyGrowth({ ...base, mastery: 0.4, baseline: 0.42 })).toMatchObject({ status: 'attention', reasons: ['low_mastery'] });
    expect(classifyGrowth({ ...base, mastery: 0.6, baseline: 0.75 }).reasons).toEqual(['declining']);
    expect(classifyGrowth({ ...base, mastery: 0.7, recentOutcomes: [1, 0, 1, 0] }).reasons).toEqual(['recent_mistakes']);
    expect(classifyGrowth({ ...base, mastery: 0.45, rawMastery: 0.62, evidenceCount: 1 }).reasons).toEqual(['not_practised']);
  });

  it('separates improving from stable and unassessed concepts', () => {
    expect(classifyGrowth({ ...base, mastery: 0.7, baseline: 0.55 })).toMatchObject({ status: 'improving', delta: 0.15 });
    expect(classifyGrowth({ ...base, mastery: 0.7, baseline: 0.66 }).status).toBe('stable');
    expect(classifyGrowth({ ...base, mastery: null, evidenceCount: 0 }).status).toBe('not_assessed');
    expect(slope([0.4, 0.5, 0.6])).toBeCloseTo(0.1, 5);
  });

  it('computes current and longest streaks of active days', () => {
    const now = new Date('2026-09-26T10:00:00Z');
    const days = new Set(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(streaks(days, now)).toEqual({ current: 3, longest: 3 });
    expect(streaks(new Set(['2026-09-25']), now)).toEqual({ current: 1, longest: 1 }); // yesterday keeps it alive
  });
});

describe('recommendation candidates (pure)', () => {
  const concept = (over: Partial<LearnerState['concepts'][number]>) => ({
    conceptId: new Types.ObjectId().toString(),
    name: 'Concept',
    importance: 0.8,
    status: 'stable' as const,
    mastery: 0.7,
    delta: 0,
    reasons: [],
    reasonText: [],
    severity: 0,
    evidenceCount: 4,
    lastPracticedAt: new Date(),
    weakLevel: null,
    source: null,
    hasEvidence: true,
    ...over,
  });
  const state = (over: Partial<LearnerState> = {}): LearnerState => ({
    projectName: 'NN',
    goal: 'Learn',
    materials: { ready: 1, pending: 0 },
    quiz: { activeSessionId: null, activeAnswered: 0, activeTarget: 0, completedCount: 2, answered: 8 },
    tutor: { questions: 3 },
    concepts: [],
    mistakePatterns: [],
    now: new Date(),
    ...over,
  });

  it('asks for material first, then a first quiz, then targets the weakest concept', () => {
    expect(buildCandidates(state({ materials: { ready: 0, pending: 0 } })).map((c) => c.kind)).toEqual(['upload_material']);
    expect(buildCandidates(state({ materials: { ready: 0, pending: 1 } }))).toEqual([]);
    const first = rankCandidates(buildCandidates(state({ quiz: { activeSessionId: null, activeAnswered: 0, activeTarget: 0, completedCount: 0, answered: 0 }, concepts: [concept({})] })), { dismissed: new Set(), ignored: new Set() });
    expect(first[0].kind).toBe('first_quiz');

    const weak = concept({ name: 'Dropout', status: 'attention', mastery: 0.35, severity: 0.8, reasons: ['low_mastery'], reasonText: ['mastery below 50 %'] });
    const ranked = rankCandidates(buildCandidates(state({ concepts: [concept({ name: 'Other' }), weak] })), { dismissed: new Set(), ignored: new Set() });
    expect(ranked[0]).toMatchObject({ kind: 'review_weak_concept', conceptIds: [weak.conceptId], action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: [weak.conceptId] } } });
    expect(ranked[0].rationale).toContain('Dropout is at 35%');
  });

  it('never repeats a dismissed recommendation and down-weights ignored ones', () => {
    const weak = concept({ status: 'attention', mastery: 0.3, severity: 0.9, reasons: ['low_mastery'], reasonText: ['x'] });
    const drafts = buildCandidates(state({ concepts: [weak] }));
    const key = drafts.find((d) => d.kind === 'review_weak_concept')!.key;
    expect(rankCandidates(drafts, { dismissed: new Set([key]), ignored: new Set() }).some((c) => c.key === key)).toBe(false);
    const normal = rankCandidates(drafts, { dismissed: new Set(), ignored: new Set() }).find((c) => c.key === key)!;
    const ignored = rankCandidates(drafts, { dismissed: new Set(), ignored: new Set([key]) }).find((c) => c.key === key)!;
    expect(ignored.priority).toBeLessThan(normal.priority);
  });
});

describe('growth, recommendations & analytics API', () => {
  let agent: Agent;
  let userId: string;
  let projectId: string;
  let provider: MockAIProvider;
  let backprop: Types.ObjectId;
  let descent: Types.ObjectId;

  async function seedLearningHistory() {
    await seedKnowledge(projectId);
    const concepts = await Concept.find({ projectId }).lean();
    backprop = concepts.find((c) => c.name === 'Backpropagation')!._id;
    descent = concepts.find((c) => c.name === 'Gradient Descent')!._id;
    const owner = new Types.ObjectId(userId);
    const project = new Types.ObjectId(projectId);
    const scope = { ownerId: owner, projectId: project };
    const level = (n: number, sum: number) => ({ n, sum });
    await Mastery.create([
      {
        ...scope,
        conceptId: backprop,
        theta: logit(0.75),
        evidenceCount: 6,
        correctCount: 5,
        scoreSum: 5,
        recentOutcomes: [0, 1, 1, 1, 1, 1],
        byLevel: { recall: level(3, 3), understand: level(1, 1), apply: level(2, 0.5), analyze: level(0, 0) },
        lastPracticedAt: new Date(),
      },
      {
        ...scope,
        conceptId: descent,
        theta: logit(0.35),
        evidenceCount: 4,
        correctCount: 1,
        scoreSum: 1,
        recentOutcomes: [1, 0, 0, 0],
        lastPracticedAt: new Date(),
      },
    ]);
    const snap = (conceptId: Types.ObjectId, mastery: number, at: Date) => ({
      ...scope,
      conceptId,
      mastery,
      theta: logit(mastery),
      evidenceCount: 1,
      cause: { type: 'attempt', attemptId: new Types.ObjectId(), sessionId: null },
      createdAt: at,
    });
    await MasterySnapshot.collection.insertMany([
      snap(backprop, 0.4, daysAgo(10)),
      snap(backprop, 0.55, daysAgo(5)),
      snap(backprop, 0.75, daysAgo(0)),
      snap(descent, 0.7, daysAgo(8)),
      snap(descent, 0.35, daysAgo(0)),
    ]);
    const attempt = (conceptId: Types.ObjectId, outcome: number, type: 'mcq' | 'open', at: Date) => ({
      ...scope,
      sessionId: new Types.ObjectId(),
      questionId: new Types.ObjectId(),
      conceptIds: [conceptId],
      type,
      difficulty: 3,
      cognitiveLevel: 'understand',
      response: { optionId: null, text: null, skipped: false },
      outcome,
      isCorrect: outcome >= 0.5,
      grading: { status: 'graded', method: 'exact', flags: [], attempts: 0 },
      masteryApplied: true,
      timeMs: 60_000,
      idempotencyKey: new Types.ObjectId().toString(),
      createdAt: at,
      updatedAt: at,
    });
    await Attempt.collection.insertMany([
      attempt(backprop, 1, 'mcq', daysAgo(0)),
      attempt(backprop, 1, 'mcq', daysAgo(0)),
      attempt(descent, 0, 'mcq', daysAgo(0)),
      attempt(descent, 0.5, 'open', daysAgo(1)),
    ]);
    await ActivityEvent.collection.insertMany([
      { ownerId: owner, actorId: owner, projectId: project, type: 'quiz.question_answered', metadata: {}, createdAt: daysAgo(0) },
      { ownerId: owner, actorId: owner, projectId: project, type: 'tutor.answered', metadata: {}, createdAt: daysAgo(1) },
      { ownerId: owner, actorId: owner, projectId: project, type: 'quiz.completed', metadata: {}, createdAt: daysAgo(2) },
    ]);
  }

  beforeEach(async () => {
    provider = installMockAI();
    let user;
    ({ agent, user } = await registerLearner());
    userId = user.id;
    const space = await createSpace(agent);
    projectId = (await createProject(agent, space.id)).id;
  });

  it('classifies concept growth over the window with a progress series and factual insights', async () => {
    await seedLearningHistory();
    const res = await agent.get(`/api/projects/${projectId}/growth?window=7d`);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.concepts.map((c: { name: string }) => [c.name, c]));
    expect(byName.Backpropagation).toMatchObject({ status: 'improving', baseline: 0.4, baselineKind: 'window_start', mastery: 0.75, delta: 0.35 });
    // Its 8-day-old snapshot precedes the 7-day window, so Δ is measured from the window start (0.70 → 0.35).
    expect(byName['Gradient Descent']).toMatchObject({ status: 'attention', baselineKind: 'window_start', baseline: 0.7 });
    expect(byName['Gradient Descent'].reasons).toEqual(expect.arrayContaining(['low_mastery', 'declining', 'recent_mistakes']));
    expect(res.body.summary.counts).toMatchObject({ improving: 1, attention: 1 });
    expect(res.body.progressSeries.length).toBe(8);
    expect(res.body.progressSeries.at(-1).overallMastery).toBeGreaterThan(0.5);
    expect(res.body.insights[0].text).toContain('Backpropagation improved from 40 % to 75 %');
    expect(res.body.insights.map((i: { text: string }) => i.text).join(' ')).toContain('apply questions remain difficult');

    const intruder = await registerLearner();
    expect((await intruder.agent.get(`/api/projects/${projectId}/growth`)).status).toBe(404);
  });

  it('recommends the next action from evidence, keeps it stable, and supports dismiss / act', async () => {
    await seedLearningHistory();
    const first = await agent.get(`/api/projects/${projectId}/recommendations`);
    expect(first.status).toBe(200);
    const top = first.body.items[0];
    expect(top).toMatchObject({ kind: 'review_weak_concept', action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: [descent.toString()] } } });
    expect(top.concepts).toEqual([{ id: descent.toString(), name: 'Gradient Descent' }]);
    expect(top.review).toMatchObject({ materialTitle: 'Machine Learning Notes' });
    expect(await AiEvaluation.countDocuments({ subjectType: 'recommendation', evaluator: 'rules' })).toBe(first.body.items.length);

    // Unchanged state → same batch (no regeneration, no extra AI work).
    const again = await agent.get(`/api/projects/${projectId}/recommendations`);
    expect(again.body.items.map((i: { id: string }) => i.id)).toEqual(first.body.items.map((i: { id: string }) => i.id));

    const dismissed = await agent.post(`/api/projects/${projectId}/recommendations/${top.id}/dismiss`).set(XRW);
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.items.some((i: { kind: string; concepts: Array<{ id: string }> }) => i.kind === 'review_weak_concept' && i.concepts[0]?.id === descent.toString())).toBe(false);

    const next = dismissed.body.items[0];
    expect((await agent.post(`/api/projects/${projectId}/recommendations/${next.id}/act`).set(XRW)).status).toBe(204);
    expect(await Recommendation.findById(next.id).lean()).toMatchObject({ status: 'completed' });
    expect(await ActivityEvent.countDocuments({ type: { $in: ['recommendation.dismissed', 'recommendation.completed'] } })).toBe(2);

    const intruder = await registerLearner();
    expect((await intruder.agent.post(`/api/projects/${projectId}/recommendations/${next.id}/dismiss`).set(XRW)).status).toBe(404);
  });

  it('phrases recommendations with the model but keeps rule text when it invents numbers', async () => {
    await seedLearningHistory();
    const original = provider.handlers.generate!;
    provider.handlers.generate = (model, request) => {
      if (request.system?.includes('next-step recommendations')) {
        const keys = [...(request.contents[0].parts[0].text ?? '').matchAll(/- key: (\S+)/g)].map((m) => m[1]);
        return JSON.stringify({
          items: keys.map((key, i) =>
            i === 0
              ? { key, title: 'Strengthen Gradient Descent before moving on', rationale: 'You are at 35% and missed recent questions — a short review will help.' }
              : { key, title: 'Invented stat recommendation', rationale: 'You improved by 99 points this week, keep going now.' },
          ),
        });
      }
      return original(model, request);
    };
    const res = await agent.get(`/api/projects/${projectId}/recommendations`);
    await drainJobs({ types: ['recommendations.phrase'] });
    const recs = await Recommendation.find({ projectId, status: 'active' }).sort({ priority: -1 }).lean();
    expect(recs[0]).toMatchObject({ title: 'Strengthen Gradient Descent before moving on', source: 'ai' });
    expect(recs.slice(1).every((r) => r.source === 'rules')).toBe(true);
    expect(res.body.items.length).toBe(recs.length);
    // The phrased text is what the learner reads, so its rule checks replace the template's.
    const evaluation = await AiEvaluation.findOne({ subjectType: 'recommendation', subjectId: recs[0]._id, evaluator: 'rules' }).lean();
    expect(evaluation).toMatchObject({ promptVersion: 'recommend.v2', verdict: 'pass' });
    expect(evaluation!.outputPreview).toContain('Strengthen Gradient Descent');

    const admin = await loginAsNewAdmin();
    const overview = await admin.get('/api/admin/ai/evaluations/overview?range=7d');
    expect(overview.status).toBe(200);
    expect(overview.body.recommendations).toMatchObject({ checked: recs.length, generated: recs.length, passRate: 1 });
    expect(overview.body.recommendations.aiPhrasedRate).toBeCloseTo(1 / recs.length, 3);
  });

  it('recommends uploading material when the Project is empty', async () => {
    const res = await agent.get(`/api/projects/${projectId}/recommendations`);
    expect(res.body.items).toEqual([expect.objectContaining({ kind: 'upload_material', action: expect.objectContaining({ type: 'upload_material' }) })]);
  });

  it('reports Project analytics: activity, assessment performance, mastery and AI activity', async () => {
    await seedLearningHistory();
    const res = await agent.get(`/api/projects/${projectId}/analytics?range=7d`);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ answered: 4, quizzesCompleted: 0, activeDays: 3 });
    expect(res.body.kpis.accuracy).toBe(0.75); // the written answer scored 0.5 counts as correct
    expect(res.body.activity.series).toHaveLength(7);
    expect(res.body.activity.series.at(-1)).toMatchObject({ answers: 1 });
    expect(res.body.assessment.byType.map((t: { key: string }) => t.key)).toEqual(['mcq', 'open']);
    expect(res.body.mastery.bands).toMatchObject({ strong: 0, developing: 1, needs_attention: 1 });
    expect(res.body.conceptTrends.improving[0]).toMatchObject({ name: 'Backpropagation' });
    expect(res.body.conceptTrends.declining[0]).toMatchObject({ name: 'Gradient Descent' });
    expect(res.body.kpis.streak.current).toBe(3);
  });

  it('aggregates global analytics across Spaces and Projects and fills the home dashboard', async () => {
    await seedLearningHistory();
    const res = await agent.get('/api/analytics?range=30d');
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({ projects: 1, answered: 4, assessedConcepts: 2, totalConcepts: 2 });
    expect(res.body.perProject[0]).toMatchObject({ id: projectId, assessedConcepts: 2, needsAttention: 1 });
    expect(res.body.perSpace[0]).toMatchObject({ projects: 1, assessedConcepts: 2 });

    const home = await agent.get('/api/dashboard');
    expect(home.status).toBe(200);
    expect(home.body.progress).toMatchObject({ assessedConcepts: 2, totalConcepts: 2, improving: 1 });
    expect(home.body.attention[0]).toMatchObject({ name: 'Gradient Descent', projectId });
    expect(home.body.recommendation).toMatchObject({ kind: 'review_weak_concept', projectName: 'Neural Networks' });

    // The Space dashboard shows progress and areas requiring attention across its Projects (PRD §4).
    const spaceId = res.body.perSpace[0].id;
    const space = await agent.get(`/api/spaces/${spaceId}`);
    expect(space.status).toBe(200);
    expect(space.body.progress).toMatchObject({ assessedConcepts: 2, totalConcepts: 2, improving: 1 });
    expect(space.body.attention[0]).toMatchObject({ name: 'Gradient Descent', projectId });
    expect(space.body.projectProgress[0]).toMatchObject({ projectId, assessedConcepts: 2, needsAttention: 1, improving: 1 });
    const empty = await createSpace(agent, { name: 'Empty space' });
    expect((await agent.get(`/api/spaces/${empty.id}`)).body).toMatchObject({ progress: null, attention: [], projectProgress: [] });
  });

  it('gives admins engagement and learning analytics, and nobody else', async () => {
    await seedLearningHistory();
    const admin = await loginAsNewAdmin();
    const engagement = await admin.get('/api/admin/engagement?range=7d');
    expect(engagement.status).toBe(200);
    expect(engagement.body.kpis).toMatchObject({ learners: 1, wau: 1, mau: 1 });
    expect(engagement.body.series).toHaveLength(7);
    expect(engagement.body.adoption.find((a: { type: string }) => a.type === 'tutor.answered')).toMatchObject({ users: 1 });

    const learning = await admin.get('/api/admin/learning?range=30d');
    expect(learning.status).toBe(200);
    expect(learning.body.answers).toMatchObject({ answered: 4, learners: 1 });
    expect(learning.body.mastery.bands).toMatchObject({ needs_attention: 1, developing: 1 });

    // The learner's detail page carries their streak, 7-day concept trends and recommendation response.
    await agent.get(`/api/projects/${projectId}/recommendations`);
    const detail = await admin.get(`/api/admin/users/${userId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.growth.streak.current).toBeGreaterThanOrEqual(1);
    expect(detail.body.growth.projects[0]).toMatchObject({ projectId, counts: { improving: 1, attention: 1 } });
    expect(detail.body.growth.projects[0].attention[0]).toMatchObject({ name: 'Gradient Descent' });
    expect(detail.body.growth.recommendations.generated).toBeGreaterThan(0);
    expect(detail.body.growth.recommendations.active.length).toBeGreaterThan(0);

    expect((await agent.get('/api/admin/engagement')).status).toBe(403);
    expect((await agent.get('/api/admin/learning')).status).toBe(403);
  });
});
