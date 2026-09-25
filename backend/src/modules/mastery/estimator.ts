import type { ILevelStat } from '../../models/mastery.model';
import { COGNITIVE_LEVELS, QUESTION_TYPES, type CognitiveLevel, type QuestionType } from '../../models/quiz.model';

/*
 * Mastery estimation (docs/ARCHITECTURE.md §17) — pure functions, no I/O.
 *
 *   p        = σ(θ − b_d),  b_d = 0.8·(d − 3)          predicted P(correct) at difficulty d ∈ 1..5
 *   K        = max(0.3, 1 / (1 + n/4))                 large early updates, stable later
 *   w        = 1.0 (MCQ) · 1.25 (open-ended)           written answers carry more evidence
 *   θ        ← clamp(θ + K·w·(o − p), −4, 4)           a hard question answered well ⇒ a big gain
 *   mastery  = σ(θ − min(1, 0.02·max(0, days − 3)))    bounded decay without practice
 *
 * Mastery is an estimate, never a claim: it is reported with its evidence count and a confidence level, and a
 * concept without evidence is "not assessed" rather than 50 %.
 */

export const THETA_MIN = -4;
export const THETA_MAX = 4;
const DECAY_GRACE_DAYS = 3;
const DECAY_PER_DAY = 0.02;
const DECAY_MAX = 1;
const DAY_MS = 86_400_000;

export const TYPE_WEIGHT: Record<QuestionType, number> = { mcq: 1, open: 1.25 };

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Item difficulty on the ability scale: d = 3 is "average" (b = 0). */
export const difficultyOffset = (difficulty: number) => 0.8 * (difficulty - 3);

export function predictCorrect(theta: number, difficulty: number): number {
  return sigmoid(theta - difficultyOffset(difficulty));
}

export function learningRate(evidenceCount: number): number {
  return Math.max(0.3, 1 / (1 + evidenceCount / 4));
}

export interface ThetaUpdate {
  theta: number;
  predicted: number;
  rate: number;
  delta: number;
}

/** One Elo/IRT step for an outcome o ∈ [0, 1] (MCQ 0/1, open-ended rubric score). */
export function updateTheta(input: { theta: number; evidenceCount: number; outcome: number; difficulty: number; type: QuestionType }): ThetaUpdate {
  const predicted = predictCorrect(input.theta, input.difficulty);
  const rate = learningRate(input.evidenceCount);
  const outcome = clamp(input.outcome, 0, 1);
  const theta = clamp(input.theta + rate * TYPE_WEIGHT[input.type] * (outcome - predicted), THETA_MIN, THETA_MAX);
  return { theta: round(theta), predicted: round(predicted), rate: round(rate), delta: round(theta - input.theta) };
}

export function daysSince(date: Date | string | null | undefined, now: Date): number {
  if (!date) return 0;
  return Math.max(0, (now.getTime() - new Date(date).getTime()) / DAY_MS);
}

/** θ after forgetting: nothing for 3 days, then −0.02 per day, at most −1. */
export function effectiveTheta(theta: number, lastPracticedAt: Date | string | null | undefined, now: Date): number {
  const decay = Math.min(DECAY_MAX, DECAY_PER_DAY * Math.max(0, daysSince(lastPracticedAt, now) - DECAY_GRACE_DAYS));
  return theta - decay;
}

export interface MasteryState {
  theta: number;
  evidenceCount: number;
  lastPracticedAt: Date | string | null;
}

/** Effective mastery 0–1, or null when the concept has not been assessed. */
export function masteryOf(state: MasteryState | null | undefined, now: Date): number | null {
  if (!state || state.evidenceCount <= 0) return null;
  return round(sigmoid(effectiveTheta(state.theta, state.lastPracticedAt, now)));
}

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export function confidenceOf(evidenceCount: number): Confidence {
  if (evidenceCount <= 0) return 'none';
  if (evidenceCount < 3) return 'low';
  if (evidenceCount < 8) return 'medium';
  return 'high';
}

export type MasteryBand = 'not_assessed' | 'needs_attention' | 'developing' | 'strong';

export function bandOf(mastery: number | null): MasteryBand {
  if (mastery === null) return 'not_assessed';
  if (mastery < 0.5) return 'needs_attention';
  if (mastery < 0.8) return 'developing';
  return 'strong';
}

/**
 * Project progress (docs/ARCHITECTURE.md §18): importance-weighted mean mastery over assessed concepts, always
 * reported together with coverage (assessed / total) — a high score on two of twenty concepts is not "done".
 */
export function masterySummary(items: Array<{ mastery: number | null; importance: number }>) {
  const assessed = items.filter((i) => i.mastery !== null);
  const weight = assessed.reduce((n, i) => n + (0.5 + 0.5 * i.importance), 0);
  const weighted = assessed.reduce((n, i) => n + (i.mastery as number) * (0.5 + 0.5 * i.importance), 0);
  return {
    totalConcepts: items.length,
    assessedConcepts: assessed.length,
    coverage: items.length ? round(assessed.length / items.length, 3) : 0,
    overallMastery: assessed.length ? round(weighted / weight, 3) : null,
    needsAttention: assessed.filter((i) => (i.mastery as number) < 0.5).length,
    strong: assessed.filter((i) => (i.mastery as number) >= 0.8).length,
  };
}
export type MasterySummary = ReturnType<typeof masterySummary>;

/** Laplace-smoothed accuracy: an unseen level counts as 0.5, a single answer does not swing it to 0 or 1. */
export const smoothedAccuracy = (stat: ILevelStat | undefined) => ((stat?.sum ?? 0) + 1) / ((stat?.n ?? 0) + 2);

export const emptyLevelStats = (): Record<CognitiveLevel, ILevelStat> =>
  Object.fromEntries(COGNITIVE_LEVELS.map((l) => [l, { n: 0, sum: 0 }])) as Record<CognitiveLevel, ILevelStat>;

export const emptyTypeStats = (): Record<QuestionType, ILevelStat> =>
  Object.fromEntries(QUESTION_TYPES.map((t) => [t, { n: 0, sum: 0 }])) as Record<QuestionType, ILevelStat>;

/** The level with the weakest (smoothed) accuracy among those assessed at least once, if any. */
export function weakestLevel(byLevel: Partial<Record<CognitiveLevel, ILevelStat>>): { level: CognitiveLevel; accuracy: number } | null {
  const assessed = COGNITIVE_LEVELS.filter((l) => (byLevel[l]?.n ?? 0) > 0).map((level) => ({ level, accuracy: smoothedAccuracy(byLevel[level]) }));
  if (assessed.length === 0) return null;
  return assessed.sort((a, b) => a.accuracy - b.accuracy)[0];
}

export interface EvidenceUpdate {
  theta: number;
  evidenceCount: number;
  correctCount: number;
  scoreSum: number;
  byLevel: Record<CognitiveLevel, ILevelStat>;
  byType: Record<QuestionType, ILevelStat>;
  recentOutcomes: number[];
  step: ThetaUpdate;
}

/** Folds one graded answer into a concept's state (the persisted document is updated with the result). */
export function applyEvidence(
  state: {
    theta: number;
    evidenceCount: number;
    correctCount: number;
    scoreSum: number;
    byLevel?: Partial<Record<CognitiveLevel, ILevelStat>>;
    byType?: Partial<Record<QuestionType, ILevelStat>>;
    recentOutcomes?: number[];
  },
  evidence: { outcome: number; difficulty: number; type: QuestionType; cognitiveLevel: CognitiveLevel; isCorrect: boolean },
): EvidenceUpdate {
  const step = updateTheta({ theta: state.theta, evidenceCount: state.evidenceCount, outcome: evidence.outcome, difficulty: evidence.difficulty, type: evidence.type });
  const byLevel = { ...emptyLevelStats(), ...structuredClone(state.byLevel ?? {}) };
  const byType = { ...emptyTypeStats(), ...structuredClone(state.byType ?? {}) };
  byLevel[evidence.cognitiveLevel] = { n: byLevel[evidence.cognitiveLevel].n + 1, sum: round(byLevel[evidence.cognitiveLevel].sum + evidence.outcome) };
  byType[evidence.type] = { n: byType[evidence.type].n + 1, sum: round(byType[evidence.type].sum + evidence.outcome) };
  return {
    theta: step.theta,
    evidenceCount: state.evidenceCount + 1,
    correctCount: state.correctCount + (evidence.isCorrect ? 1 : 0),
    scoreSum: round(state.scoreSum + evidence.outcome),
    byLevel,
    byType,
    recentOutcomes: [...(state.recentOutcomes ?? []), round(evidence.outcome, 3)].slice(-10),
    step,
  };
}
