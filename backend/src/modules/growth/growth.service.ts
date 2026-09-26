import type { Types } from 'mongoose';
import { Concept } from '../../models/knowledge.model';
import { Mastery, MasterySnapshot, type IMastery } from '../../models/mastery.model';
import { Material } from '../../models/material.model';
import { COGNITIVE_LEVELS } from '../../models/quiz.model';
import { confidenceOf, masteryOf, masterySummary, sigmoid } from '../mastery/estimator';
import { getOwnedProject } from '../projects/projects.service';
import { attentionSeverity, classifyGrowth, REASON_TEXT, type AttentionReason, type GrowthStatus } from './classify';

/*
 * Growth analysis (PRD §10, docs/ARCHITECTURE.md §18): how each concept's estimated mastery changed over a window,
 * read from `mastery_snapshots` (one per concept per graded answer). Answers "improving / stable / requiring
 * attention", draws the Project's progress over time and turns the numbers into short, factual insights.
 */

const DAY_MS = 86_400_000;
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export const GROWTH_WINDOWS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type GrowthWindow = keyof typeof GROWTH_WINDOWS;

export interface ConceptGrowth {
  conceptId: string;
  name: string;
  importance: number;
  status: GrowthStatus;
  mastery: number | null;
  baseline: number | null;
  baselineKind: 'window_start' | 'first_assessment' | null;
  delta: number | null;
  trend: number | null;
  reasons: AttentionReason[];
  reasonText: string[];
  severity: number;
  evidenceCount: number;
  confidence: ReturnType<typeof confidenceOf>;
  lastPracticedAt: Date | null;
  weakLevel: { level: string; accuracy: number } | null;
  strongLevel: { level: string; accuracy: number } | null;
  series: Array<{ date: string; mastery: number | null }>;
  source: { materialId: string; materialTitle: string; pages: number[] } | null;
}

function levelGap(m: IMastery | undefined) {
  if (!m) return { weak: null, strong: null };
  const levels = COGNITIVE_LEVELS.map((level) => ({ level, n: m.byLevel?.[level]?.n ?? 0, accuracy: m.byLevel?.[level]?.n ? m.byLevel[level].sum / m.byLevel[level].n : 0 })).filter(
    (l) => l.n >= 2,
  );
  if (levels.length < 2) return { weak: null, strong: null };
  const sorted = [...levels].sort((a, b) => a.accuracy - b.accuracy);
  const weak = sorted[0];
  const strong = sorted[sorted.length - 1];
  if (strong.accuracy - weak.accuracy < 0.3 || weak.accuracy > 0.6) return { weak: null, strong: null };
  return { weak: { level: weak.level, accuracy: round(weak.accuracy) }, strong: { level: strong.level, accuracy: round(strong.accuracy) } };
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);

/** Factual one-liners the learner can act on (no model call: every number comes from the data). */
function insightsFor(concepts: ConceptGrowth[], coverage: { assessed: number; total: number }) {
  const insights: Array<{ kind: 'improving' | 'attention' | 'gap' | 'coverage' | 'stable'; conceptId: string | null; text: string }> = [];
  const improving = concepts.filter((c) => c.status === 'improving').sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  for (const c of improving.slice(0, 2)) {
    const tail = c.weakLevel ? `, but ${c.weakLevel.level} questions remain difficult (${pct(c.weakLevel.accuracy)} correct)` : '';
    insights.push({ kind: 'improving', conceptId: c.conceptId, text: `Your understanding of ${c.name} improved from ${pct(c.baseline)} to ${pct(c.mastery)}${tail}.` });
  }
  const attention = concepts.filter((c) => c.status === 'attention').sort((a, b) => b.severity - a.severity);
  for (const c of attention.slice(0, 2)) {
    insights.push({ kind: 'attention', conceptId: c.conceptId, text: `${c.name} needs attention — ${c.reasonText.join('; ')} (now ${pct(c.mastery)}).` });
  }
  const gaps = concepts.filter((c) => c.weakLevel && c.strongLevel && c.status !== 'improving').slice(0, 1);
  for (const c of gaps) {
    insights.push({
      kind: 'gap',
      conceptId: c.conceptId,
      text: `${c.name}: ${c.strongLevel!.level} is strong (${pct(c.strongLevel!.accuracy)}) but ${c.weakLevel!.level} questions are harder (${pct(c.weakLevel!.accuracy)}).`,
    });
  }
  const unassessed = coverage.total - coverage.assessed;
  if (coverage.total > 0 && unassessed > 0) {
    insights.push({ kind: 'coverage', conceptId: null, text: `${unassessed} of ${coverage.total} concepts have not been assessed yet — a quiz will show where you stand.` });
  }
  if (!insights.length && concepts.some((c) => c.status === 'stable')) {
    insights.push({ kind: 'stable', conceptId: null, text: 'Your mastery is steady. A mixed quiz keeps it that way and checks deeper levels of understanding.' });
  }
  return insights.slice(0, 5);
}

/** Growth for one Project over a window (7, 30 or 90 days). */
export async function computeProjectGrowth(ownerId: Types.ObjectId, projectId: Types.ObjectId, windowDays: number, now = new Date()) {
  const scope = { ownerId, projectId };
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);
  const [concepts, masteries, snapshots] = await Promise.all([
    Concept.find(scope, { name: 1, importance: 1, sources: 1 }).sort({ importance: -1, chunkCount: -1, name: 1 }).limit(200).lean(),
    Mastery.find(scope).lean(),
    MasterySnapshot.find(scope, { conceptId: 1, mastery: 1, createdAt: 1 }).sort({ createdAt: 1 }).limit(20_000).lean(),
  ]);
  const materialIds = [...new Set(concepts.flatMap((c) => c.sources.map((s) => s.materialId.toString())))];
  const titles = new Map((await Material.find({ _id: { $in: materialIds }, ownerId }, { title: 1 }).lean()).map((m) => [m._id.toString(), m.title]));
  const byConceptMastery = new Map(masteries.map((m) => [m.conceptId.toString(), m]));
  const snapsByConcept = new Map<string, Array<{ mastery: number; at: Date }>>();
  for (const s of snapshots) {
    const key = s.conceptId.toString();
    const list = snapsByConcept.get(key) ?? [];
    list.push({ mastery: s.mastery, at: new Date(s.createdAt) });
    snapsByConcept.set(key, list);
  }

  // Day keys covering the window (UTC), oldest first.
  const days: string[] = [];
  for (let t = windowStart.getTime(); t <= now.getTime() + 1; t += DAY_MS) days.push(dayKey(new Date(t)));
  if (days.at(-1) !== dayKey(now)) days.push(dayKey(now));

  const growth: ConceptGrowth[] = concepts.map((c) => {
    const id = c._id.toString();
    const m = byConceptMastery.get(id);
    const snaps = snapsByConcept.get(id) ?? [];
    const mastery = masteryOf(m, now);
    const rawMastery = m && m.evidenceCount > 0 ? round(sigmoid(m.theta)) : null;
    const before = snaps.filter((s) => s.at <= windowStart).at(-1);
    const inWindow = snaps.filter((s) => s.at > windowStart);
    const baseline = before ? before.mastery : inWindow.length >= 2 ? inWindow[0].mastery : null;
    const result = classifyGrowth({
      mastery,
      rawMastery,
      baseline,
      evidenceCount: m?.evidenceCount ?? 0,
      recentOutcomes: m?.recentOutcomes ?? [],
      snapshots: snaps.map((s) => s.mastery),
    });
    // End-of-day value per day (carried forward), so the chart shows the state the learner was in each day.
    let pointer = 0;
    let current: number | null = before ? before.mastery : null;
    const series = days.map((date) => {
      const end = new Date(`${date}T23:59:59.999Z`);
      while (pointer < inWindow.length && inWindow[pointer].at <= end) current = inWindow[pointer++].mastery;
      return { date, mastery: current === null ? null : round(current) };
    });
    const gap = levelGap(m);
    const source = c.sources.find((s) => s.pages.length) ?? c.sources[0];
    return {
      conceptId: id,
      name: c.name,
      importance: c.importance ?? 0.5,
      status: result.status,
      mastery,
      baseline,
      baselineKind: before ? 'window_start' : baseline !== null ? 'first_assessment' : null,
      delta: result.delta,
      trend: result.trend,
      reasons: result.reasons,
      reasonText: result.reasons.map((r) => REASON_TEXT[r]),
      severity: attentionSeverity({ mastery, reasons: result.reasons, delta: result.delta }),
      evidenceCount: m?.evidenceCount ?? 0,
      confidence: confidenceOf(m?.evidenceCount ?? 0),
      lastPracticedAt: m?.lastPracticedAt ?? null,
      weakLevel: gap.weak,
      strongLevel: gap.strong,
      series,
      source: source ? { materialId: source.materialId.toString(), materialTitle: titles.get(source.materialId.toString()) ?? 'Material', pages: source.pages.slice(0, 6) } : null,
    };
  });

  // Project progress over time: importance-weighted mean over concepts assessed by that day (+ coverage).
  const progressSeries = days.map((date, i) => {
    const values = growth.map((g) => ({ mastery: g.series[i].mastery, importance: g.importance })).filter((v) => v.mastery !== null);
    const weight = values.reduce((n, v) => n + (0.5 + 0.5 * v.importance), 0);
    const mean = weight ? values.reduce((n, v) => n + (v.mastery as number) * (0.5 + 0.5 * v.importance), 0) / weight : null;
    return { date, overallMastery: mean === null ? null : round(mean), assessed: values.length };
  });

  const summary = masterySummary(growth.map((g) => ({ mastery: g.mastery, importance: g.importance })));
  const counts = { improving: 0, stable: 0, attention: 0, not_assessed: 0 } as Record<GrowthStatus, number>;
  for (const g of growth) counts[g.status] += 1;
  const startValue = progressSeries.find((p) => p.overallMastery !== null) ?? null;

  return {
    window: { days: windowDays, from: windowStart, to: now },
    summary: {
      ...summary,
      counts,
      overallAtStart: startValue?.overallMastery ?? null,
      overallChange: startValue && summary.overallMastery !== null ? round(summary.overallMastery - (startValue.overallMastery as number)) : null,
      answersInWindow: snapshots.filter((s) => new Date(s.createdAt) > windowStart).length,
    },
    concepts: growth,
    progressSeries,
    insights: insightsFor(growth, { assessed: summary.assessedConcepts, total: summary.totalConcepts }),
  };
}
export type ProjectGrowth = Awaited<ReturnType<typeof computeProjectGrowth>>;

/** GET /projects/:projectId/growth?window=7d|30d|90d */
export async function getProjectGrowth(ownerId: string, projectId: string, window: GrowthWindow) {
  const project = await getOwnedProject(ownerId, projectId);
  const growth = await computeProjectGrowth(project.ownerId, project._id, GROWTH_WINDOWS[window]);
  return { project: { id: project._id.toString(), name: project.name, learningGoal: project.learningGoal }, ...growth };
}
