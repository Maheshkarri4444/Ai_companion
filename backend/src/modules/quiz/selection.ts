import { createHash } from 'node:crypto';
import type { ILevelStat } from '../../models/mastery.model';
import type { CognitiveLevel, QuestionType, QuestionTypePreference, QuizMode } from '../../models/quiz.model';
import { daysSince, predictCorrect, smoothedAccuracy } from '../mastery/estimator';

/*
 * Adaptive question selection (PRD §9, docs/ARCHITECTURE.md §16) — pure functions, no I/O.
 *
 * Not "wrong → easy, right → hard". Each concept gets a priority from all the learning evidence:
 *
 *   priority(c) = 0.35·(1 − m) + 0.20·u + 0.20·mistake + 0.15·due + 0.10·importance + 0.10·studied − 0.30·recent
 *     m        effective mastery (decayed; 0.5 when not assessed)   u        uncertainty = 1 / (1 + n/3)
 *     mistake  min(1, wrong answers in the last 5 on c / 2)         due      min(1, days since practice / (1 + 6·m²)); 1 if never
 *     studied  1 if the learner studied c with the Tutor recently   recent   1 if c was asked in the last 2 questions (interleaving)
 *
 * The concept is sampled from softmax(priority / 0.15): mostly where practice helps most, with some exploration.
 * Difficulty then follows the ability estimate θ (targeting P(correct) ≈ 0.7 — desirable difficulty), nudged by the
 * session's momentum; question type and cognitive level follow the evidence per type and level.
 */

export const WEIGHTS = { weakness: 0.35, uncertainty: 0.2, mistakes: 0.2, due: 0.15, importance: 0.1, studied: 0.1, recent: -0.3 } as const;
const TEMPERATURE = 0.15;
export const TARGET_P = 0.7;
const OPEN_SHARE = 0.3;

/** What the engine knows about one concept when choosing the next question. */
export interface ConceptState {
  conceptId: string;
  name: string;
  importance: number;
  /** A concept without source passages cannot get a grounded question. */
  hasEvidence: boolean;
  theta: number;
  evidenceCount: number;
  /** Effective (decayed) mastery, or null when not assessed. */
  mastery: number | null;
  lastPracticedAt: Date | null;
  /** Last outcomes on this concept across sessions, oldest first. */
  recentOutcomes: number[];
  byLevel: Partial<Record<CognitiveLevel, ILevelStat>>;
  byType: Partial<Record<QuestionType, ILevelStat>>;
  /** Discussed with the Tutor recently (cited in a recent answer). */
  studiedRecently: boolean;
}

export interface SessionState {
  mode: QuizMode;
  typePreference: QuestionTypePreference;
  /** 1-based position of the question being selected. */
  position: number;
  targetCount: number;
  /** Concepts of the questions already served in this session, newest first. */
  recentConceptIds: string[];
  /** Outcomes of the answers in this session, in order (graded ones only). */
  outcomes: number[];
  openServed: number;
  focusConceptIds: string[];
  /** Concepts to skip (e.g. generation failed for them this time). */
  excludeConceptIds: string[];
}

export interface Selection {
  conceptId: string;
  conceptName: string;
  type: QuestionType;
  difficulty: number;
  cognitiveLevel: CognitiveLevel;
  predictedP: number;
  targetP: number;
  priority: number;
  probability: number;
  explored: boolean;
  mastery: number | null;
  evidence: number;
  reason: string;
  components: Record<string, number>;
}

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Deterministic PRNG (mulberry32) seeded from a string: the same session position always makes the same choice. */
export function seededRandom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function priorityComponents(c: ConceptState, session: Pick<SessionState, 'recentConceptIds'>, now: Date) {
  const m = c.mastery ?? 0.5;
  const lastFive = c.recentOutcomes.slice(-5);
  const wrong = lastFive.filter((o) => o < 0.5).length;
  const days = daysSince(c.lastPracticedAt, now);
  return {
    weakness: round(1 - m),
    uncertainty: round(1 / (1 + c.evidenceCount / 3)),
    mistakes: round(Math.min(1, wrong / 2)),
    due: c.evidenceCount === 0 ? 1 : round(Math.min(1, days / (1 + 6 * m * m))),
    importance: round(Math.max(0, Math.min(1, c.importance))),
    studied: c.studiedRecently ? 1 : 0,
    recent: session.recentConceptIds.slice(0, 2).includes(c.conceptId) ? 1 : 0,
  };
}

export function conceptPriority(c: ConceptState, session: Pick<SessionState, 'recentConceptIds'>, now: Date) {
  const components = priorityComponents(c, session, now);
  const priority =
    WEIGHTS.weakness * components.weakness +
    WEIGHTS.uncertainty * components.uncertainty +
    WEIGHTS.mistakes * components.mistakes +
    WEIGHTS.due * components.due +
    WEIGHTS.importance * components.importance +
    WEIGHTS.studied * components.studied +
    WEIGHTS.recent * components.recent;
  return { priority: round(priority, 4), components };
}

/** Which concepts a session may draw from. Review mode favours past mistakes and concepts due for review. */
export function candidateConcepts(concepts: ConceptState[], session: SessionState, now: Date): ConceptState[] {
  const usable = concepts.filter((c) => c.hasEvidence && !session.excludeConceptIds.includes(c.conceptId));
  if (session.mode === 'focused' && session.focusConceptIds.length) {
    return usable.filter((c) => session.focusConceptIds.includes(c.conceptId));
  }
  if (session.mode === 'review') {
    const review = usable.filter((c) => {
      if (c.evidenceCount === 0) return false;
      const { mistakes, due } = priorityComponents(c, session, now);
      return mistakes > 0 || due >= 0.5 || (c.mastery ?? 1) < 0.5;
    });
    if (review.length) return review;
    const assessed = usable.filter((c) => c.evidenceCount > 0);
    return assessed.length ? assessed : usable;
  }
  return usable;
}

/** Momentum: two misses in a row ease the target a little, a run of successes stretches it. */
export function targetProbability(outcomes: number[]): number {
  const last = outcomes.slice(-3);
  if (last.length >= 2 && last.slice(-2).every((o) => o < 0.5)) return 0.78;
  if (last.length === 3 && last.every((o) => o >= 0.8)) return 0.62;
  return TARGET_P;
}

/** The difficulty whose predicted success probability is closest to the target (ties → nearer to 3). */
export function chooseDifficulty(theta: number, targetP: number): { difficulty: number; predictedP: number } {
  let best = { difficulty: 3, predictedP: predictCorrect(theta, 3), gap: Infinity };
  for (const d of [3, 2, 4, 1, 5]) {
    const p = predictCorrect(theta, d);
    const gap = Math.abs(p - targetP);
    if (gap < best.gap - 1e-9) best = { difficulty: d, predictedP: p, gap };
  }
  return { difficulty: best.difficulty, predictedP: round(best.predictedP) };
}

const LEVELS_BY_DIFFICULTY: Record<number, CognitiveLevel[]> = {
  1: ['recall', 'understand'],
  2: ['recall', 'understand'],
  3: ['understand', 'apply'],
  4: ['apply', 'analyze'],
  5: ['apply', 'analyze'],
};

/** The weakest level the difficulty allows (smoothed accuracy; ties → fewer answers, then the lower level). */
export function chooseLevel(difficulty: number, type: QuestionType, byLevel: ConceptState['byLevel']): CognitiveLevel {
  let allowed = LEVELS_BY_DIFFICULTY[difficulty] ?? ['understand'];
  // A written answer to a pure recall prompt measures little more than an MCQ would.
  if (type === 'open' && allowed.includes('recall')) allowed = ['understand'];
  return [...allowed].sort((a, b) => {
    const diff = smoothedAccuracy(byLevel[a]) - smoothedAccuracy(byLevel[b]);
    if (Math.abs(diff) > 1e-9) return diff;
    return (byLevel[a]?.n ?? 0) - (byLevel[b]?.n ?? 0);
  })[0];
}

/**
 * MCQ while evidence is thin; open-ended once the learner has shown some grasp of the concept (depth check), or
 * when MCQ accuracy is high but depth is unverified — about 30 % of a mixed session, never the warm-up question.
 */
export function chooseType(c: ConceptState, session: SessionState, rng: () => number): QuestionType {
  if (session.typePreference !== 'mixed') return session.typePreference;
  const openTarget = session.targetCount >= 3 ? Math.max(1, Math.round(session.targetCount * OPEN_SHARE)) : 0;
  const openNeeded = openTarget - session.openServed;
  const remaining = session.targetCount - session.position + 1;
  if (openNeeded <= 0) return 'mcq';
  if (openNeeded >= remaining) return 'open';
  if (session.position === 1) return 'mcq';
  const mcq = c.byType.mcq;
  const showedGrasp = (c.mastery ?? 0) >= 0.45 && c.evidenceCount >= 1;
  const depthUnverified = (mcq?.n ?? 0) >= 2 && smoothedAccuracy(mcq) >= 0.75 && (c.byType.open?.n ?? 0) === 0;
  return (showedGrasp || depthUnverified) && rng() < 0.6 ? 'open' : 'mcq';
}

/** Learner-facing "why this question?" — the strongest signal behind the choice. */
export function describeReason(c: ConceptState, components: Record<string, number>, now: Date): string {
  const pct = c.mastery === null ? null : Math.round(c.mastery * 100);
  if (components.mistakes >= 0.5) return `You missed a question on ${c.name} recently — a fresh one checks whether it has clicked.`;
  if (c.evidenceCount === 0) {
    return c.studiedRecently
      ? `You studied ${c.name} with Zoya recently — let's check it stuck.`
      : `You haven't been assessed on ${c.name} yet.`;
  }
  if (pct !== null && pct < 50) return `Your mastery of ${c.name} is ${pct}% — practice helps most here.`;
  if (components.due >= 0.6) {
    const days = Math.round(daysSince(c.lastPracticedAt, now));
    return `It has been ${days} day${days === 1 ? '' : 's'} since you practised ${c.name} — time for a spaced review.`;
  }
  if (c.studiedRecently) return `You studied ${c.name} with Zoya recently — let's check it stuck.`;
  if (components.uncertainty >= 0.6) return `Only ${c.evidenceCount} answer${c.evidenceCount === 1 ? '' : 's'} on ${c.name} so far — more evidence makes the estimate reliable.`;
  return `Keeping ${c.name} fresh (${pct}% mastery).`;
}

/** Picks the next concept, type, difficulty and cognitive level; null when no concept can be assessed. */
export function selectNext(concepts: ConceptState[], session: SessionState, rng: () => number, now = new Date()): Selection | null {
  const candidates = candidateConcepts(concepts, session, now);
  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => ({ c, ...conceptPriority(c, session, now) }));
  const max = Math.max(...scored.map((s) => s.priority));
  const weights = scored.map((s) => Math.exp((s.priority - max) / TEMPERATURE));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = rng() * total;
  let index = 0;
  for (; index < scored.length - 1; index++) {
    pick -= weights[index];
    if (pick <= 0) break;
  }
  const chosen = scored[index];
  const concept = chosen.c;

  const targetP = targetProbability(session.outcomes);
  const { difficulty, predictedP } = chooseDifficulty(concept.theta, targetP);
  const type = chooseType(concept, session, rng);
  return {
    conceptId: concept.conceptId,
    conceptName: concept.name,
    type,
    difficulty,
    cognitiveLevel: chooseLevel(difficulty, type, concept.byLevel),
    predictedP,
    targetP,
    priority: chosen.priority,
    probability: round(weights[index] / total),
    explored: chosen.priority < max - 1e-9,
    mastery: concept.mastery,
    evidence: concept.evidenceCount,
    reason: describeReason(concept, chosen.components, now),
    components: chosen.components,
  };
}
