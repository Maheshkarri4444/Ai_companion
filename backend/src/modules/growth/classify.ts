/*
 * Growth classification (PRD §10, docs/ARCHITECTURE.md §18) — pure functions, no I/O.
 *
 *   Requiring attention  m < 0.5 with n ≥ 2 · or Δ ≤ −0.08 · or ≥ 2 wrong in the last 4 answers · or decayed below 0.5
 *   Improving            Δ ≥ +0.08 (and not requiring attention)
 *   Stable               otherwise
 *   Not assessed         no evidence yet
 *
 * Δ compares current (decayed) mastery with the value at the start of the window; when the concept was first
 * assessed inside the window, with its first assessment instead.
 */

export const GROWTH_STATUSES = ['improving', 'stable', 'attention', 'not_assessed'] as const;
export type GrowthStatus = (typeof GROWTH_STATUSES)[number];

export type AttentionReason = 'low_mastery' | 'declining' | 'recent_mistakes' | 'not_practised';

export const DELTA_THRESHOLD = 0.08;

export interface GrowthInput {
  /** Effective (decayed) mastery now, null when not assessed. */
  mastery: number | null;
  /** σ(θ) without decay — tells "forgotten" apart from "never learned". */
  rawMastery: number | null;
  /** Baseline for Δ (window start, or first assessment inside the window). */
  baseline: number | null;
  evidenceCount: number;
  /** Most recent outcomes, oldest first (0–1). */
  recentOutcomes: number[];
  /** Chronological snapshot values used for the trend (last 5 are used). */
  snapshots: number[];
}

export interface GrowthResult {
  status: GrowthStatus;
  delta: number | null;
  /** Least-squares slope per answer over the last 5 snapshots (positive = rising). */
  trend: number | null;
  reasons: AttentionReason[];
}

const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;

export function slope(values: number[]): number | null {
  const ys = values.slice(-5);
  if (ys.length < 2) return null;
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return den === 0 ? 0 : round(num / den, 4);
}

export function classifyGrowth(input: GrowthInput): GrowthResult {
  if (input.evidenceCount <= 0 || input.mastery === null) return { status: 'not_assessed', delta: null, trend: null, reasons: [] };
  const delta = input.baseline === null ? null : round(input.mastery - input.baseline);
  const recentWrong = input.recentOutcomes.slice(-4).filter((o) => o < 0.5).length;
  const reasons: AttentionReason[] = [];
  if (input.mastery < 0.5 && input.evidenceCount >= 2) reasons.push('low_mastery');
  if (delta !== null && delta <= -DELTA_THRESHOLD) reasons.push('declining');
  if (recentWrong >= 2) reasons.push('recent_mistakes');
  if (input.rawMastery !== null && input.rawMastery >= 0.5 && input.mastery < 0.5) reasons.push('not_practised');
  const trend = slope(input.snapshots);
  if (reasons.length) return { status: 'attention', delta, trend, reasons };
  if (delta !== null && delta >= DELTA_THRESHOLD) return { status: 'improving', delta, trend, reasons };
  return { status: 'stable', delta, trend, reasons };
}

/** Severity 0–1 for ranking attention areas (used by recommendations and the home dashboard). */
export function attentionSeverity(input: { mastery: number | null; reasons: AttentionReason[]; delta: number | null }): number {
  if (!input.reasons.length) return 0;
  const gap = input.mastery === null ? 0.5 : 1 - input.mastery;
  const bonus = (input.reasons.includes('recent_mistakes') ? 0.15 : 0) + (input.reasons.includes('declining') ? Math.min(0.2, Math.abs(input.delta ?? 0)) : 0);
  return round(Math.min(1, 0.35 + 0.5 * gap + bonus));
}

export const REASON_TEXT: Record<AttentionReason, string> = {
  low_mastery: 'mastery below 50 %',
  declining: 'mastery dropped in this period',
  recent_mistakes: 'missed 2 of the last 4 questions',
  not_practised: 'not practised recently — some of it may be forgotten',
};
