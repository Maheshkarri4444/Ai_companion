import { sha256 } from '../../lib/text';
import { OPTION_IDS, type CognitiveLevel } from '../../models/quiz.model';
import { looksLikeInjection } from '../knowledge/injection';

/*
 * Rule checks for AI-generated assessment items and AI grading (docs/ARCHITECTURE.md §16) — pure functions.
 * Nothing the model produces is stored or shown before these pass: a rejected question is regenerated once with
 * the issues as feedback, and grading output is cross-checked before it can change mastery.
 */

export interface GeneratedOption {
  id: string;
  text: string;
  rationale: string;
}

export interface GeneratedMcq {
  stem: string;
  options: GeneratedOption[];
  correctOptionId: string;
  explanation: string;
  sourceIds: string[];
  difficulty: number;
  cognitiveLevel: string;
}

export interface GeneratedOpen {
  stem: string;
  keyPoints: string[];
  sampleAnswer: string;
  explanation: string;
  sourceIds: string[];
  difficulty: number;
  cognitiveLevel: string;
}

export type GeneratedQuestion = ({ type: 'mcq' } & GeneratedMcq) | ({ type: 'open' } & GeneratedOpen);

export interface ValidationResult {
  passed: boolean;
  /** Blocking problems (the question is regenerated). */
  issues: string[];
  /** Quality signals recorded for evaluation, not blocking. */
  warnings: string[];
}

/** Lower-case, accent-free, punctuation-free text with single spaces. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stems that differ only in case, punctuation or spacing hash the same (no repeated questions). */
export const stemHashOf = (stem: string) => sha256(normalizeText(stem));

const ALL_OR_NONE = /^\s*(all|none|both|neither)\s+of\s+(the\s+)?(above|these|options|answers|them)\b/i;

export function validateGeneratedQuestion(
  question: GeneratedQuestion,
  ctx: { sourceRefs: Set<string>; usedStemHashes: Set<string>; requested: { difficulty: number; cognitiveLevel: CognitiveLevel } },
): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const stem = question.stem.trim();

  if (stem.length < 15 || stem.length > 700) issues.push('stem_length');
  if (ctx.usedStemHashes.has(stemHashOf(stem))) issues.push('duplicate_stem');
  if (!question.sourceIds.some((id) => ctx.sourceRefs.has(id.trim()))) issues.push('no_valid_sources');
  if (question.sourceIds.some((id) => !ctx.sourceRefs.has(id.trim()))) warnings.push('unknown_source_ids');
  if (question.explanation.trim().length < 20) issues.push('explanation_missing');

  if (question.type === 'mcq') {
    const ids = question.options.map((o) => o.id.trim().toUpperCase());
    if (question.options.length !== 4) issues.push('option_count');
    else if (new Set(ids).size !== 4 || !OPTION_IDS.every((id) => ids.includes(id))) issues.push('option_ids');
    if (question.options.some((o) => !o.text.trim())) issues.push('empty_option');
    if (question.options.some((o) => o.text.trim().length > 300)) issues.push('option_too_long');
    const normalized = question.options.map((o) => normalizeText(o.text));
    if (new Set(normalized).size !== normalized.length) issues.push('duplicate_options');
    if (question.options.some((o) => ALL_OR_NONE.test(o.text))) issues.push('all_or_none_of_the_above');
    const correct = question.options.find((o) => o.id.trim().toUpperCase() === question.correctOptionId.trim().toUpperCase());
    if (!correct) {
      issues.push('correct_option_invalid');
    } else {
      const answer = normalizeText(correct.text);
      // A multi-word answer quoted in the stem gives the question away.
      if (answer.length >= 12 && answer.split(' ').length >= 3 && normalizeText(stem).includes(answer)) issues.push('answer_in_stem');
      const others = question.options.filter((o) => o !== correct).map((o) => o.text.trim().length);
      const mean = others.reduce((a, b) => a + b, 0) / Math.max(1, others.length);
      if (correct.text.trim().length > 40 && correct.text.trim().length > 1.6 * mean) warnings.push('correct_option_longest');
    }
    if (question.options.some((o) => o.rationale.trim().length < 8)) warnings.push('missing_rationale');
  } else {
    const points = [...new Set(question.keyPoints.map((p) => p.trim()).filter((p) => p.length >= 3))];
    if (points.length < 2 || points.length > 6) issues.push('key_points_count');
    if (question.sampleAnswer.trim().length < 30) issues.push('sample_answer_missing');
  }

  if (Number.isFinite(question.difficulty) && Math.abs(question.difficulty - ctx.requested.difficulty) >= 2) warnings.push('difficulty_mismatch');
  if (question.cognitiveLevel && question.cognitiveLevel !== ctx.requested.cognitiveLevel) warnings.push('level_mismatch');

  return { passed: issues.length === 0, issues, warnings };
}

/** Human-readable rejection reasons, sent back to the generator on its second attempt. */
export const ISSUE_HINTS: Record<string, string> = {
  stem_length: 'the question must be one clear sentence or two (15–700 characters)',
  duplicate_stem: 'the question repeats one the learner has already seen — ask something different',
  no_valid_sources: 'sourceIds must name at least one of the provided source ids (S1, S2, …) that supports the answer',
  explanation_missing: 'the explanation must say in 2–3 sentences why the answer is correct',
  option_count: 'there must be exactly 4 options',
  option_ids: 'option ids must be exactly A, B, C and D',
  empty_option: 'every option needs text',
  option_too_long: 'options must be short (under 300 characters)',
  duplicate_options: 'all four options must be different',
  all_or_none_of_the_above: 'do not use "all of the above" / "none of the above" options',
  correct_option_invalid: 'correctOptionId must be the id of one of the options',
  answer_in_stem: 'the question text must not contain the correct answer',
  key_points_count: 'give 2–5 distinct key points',
  sample_answer_missing: 'give a complete model answer (2–5 sentences)',
};

/** Fisher–Yates shuffle, then re-letter A–D: generators favour putting the answer first. */
export function shuffleOptions(options: GeneratedOption[], correctOptionId: string, rng: () => number) {
  const tagged = options.map((o) => ({ ...o, correct: o.id.trim().toUpperCase() === correctOptionId.trim().toUpperCase() }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const relettered = tagged.map((o, i) => ({ id: OPTION_IDS[i], text: o.text.trim(), rationale: o.rationale.trim(), correct: o.correct }));
  return {
    options: relettered.map(({ id, text, rationale }) => ({ id, text, rationale })),
    correctOptionId: relettered.find((o) => o.correct)?.id ?? 'A',
  };
}

/* ─────────────────────────────── Grading ─────────────────────────────── */

const NON_ANSWER = /^\s*(i\s*(really\s+)?(don'?t|do\s+not|dont)\s+know|idk|no\s+idea|not\s+sure|no\s+clue|pass|skip|dunno|n\/?a|\?+|-+|\.+)\s*[.!?]*\s*$/i;

/** Empty or "I don't know": graded 0 without a model call, with the model answer as feedback. */
export function isNonAnswer(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  return value.length === 0 || NON_ANSWER.test(value);
}

const GRADE_GAMING = [/\b(full|maximum|max|perfect|top)\s+(marks?|scores?|points|grade)\b/i, /\b(mark|grade|score|rate)\s+(this|me|my\s+answer)\s+(as\s+)?(correct|right|1(\.0)?|100|10\s*\/\s*10|full)/i];

/** An answer that tries to instruct the grader is still graded, but flagged (and the grader is warned). */
export function looksLikeGradeManipulation(text: string): boolean {
  return looksLikeInjection(text) || GRADE_GAMING.some((p) => p.test(text));
}

export type KeyPointStatus = 'covered' | 'partial' | 'missing';

export interface GradeOutput {
  keyPoints: Array<{ id: string; status: KeyPointStatus; evidence: string }>;
  accuracy: number;
  relevance: number;
  reasoning: number;
  misconceptions: string[];
  understood: string[];
  missing: string[];
  feedback: string;
  overallScore: number;
}

const STATUS_VALUE: Record<KeyPointStatus, number> = { covered: 1, partial: 0.5, missing: 0 };

/** True when most words of a quoted span actually occur in the learner's answer. */
export function quoteFoundIn(answer: string, quote: string): boolean {
  const words = normalizeText(quote)
    .split(' ')
    .filter((w) => w.length >= 3);
  if (words.length === 0) return true;
  const inAnswer = new Set(normalizeText(answer).split(' '));
  return words.filter((w) => inAnswer.has(w)).length / words.length >= 0.6;
}

export interface OpenScore {
  score: number;
  coverage: number;
  statuses: Array<{ status: KeyPointStatus; evidence: string }>;
  components: { coverage: number; accuracy: number; relevance: number; reasoning: number; misconceptions: number; holistic: number };
  flags: string[];
}

/**
 * The score is computed from the rubric verdicts rather than taken from the model: coverage of the key points
 * dominates, factual accuracy and reasoning refine it, stated misconceptions cost, and an off-topic answer is
 * capped. A "covered" verdict must quote the learner's own words — a quote that isn't in the answer is
 * downgraded to "partial" (the grader cannot credit what the learner did not write).
 */
export function scoreOpenAnswer(output: GradeOutput, keyPointCount: number, answer: string): OpenScore {
  const flags: string[] = [];
  const byId = new Map(output.keyPoints.map((k) => [k.id.trim().toUpperCase(), k]));
  if (output.keyPoints.length !== keyPointCount) flags.push('key_point_count_mismatch');
  const statuses = Array.from({ length: keyPointCount }, (_, i) => {
    const verdict = byId.get(`K${i + 1}`) ?? output.keyPoints[i];
    if (!verdict) return { status: 'missing' as const, evidence: '' };
    let status = verdict.status;
    const evidence = verdict.evidence.trim();
    if (status === 'covered' && !evidence) flags.push('unquoted_evidence');
    if (status !== 'missing' && evidence && !quoteFoundIn(answer, evidence)) {
      flags.push('evidence_not_in_answer');
      if (status === 'covered') status = 'partial';
    }
    return { status, evidence };
  });
  const coverage = statuses.length ? statuses.reduce((n, s) => n + STATUS_VALUE[s.status], 0) / statuses.length : 0;
  const norm = (v: number) => (Math.max(1, Math.min(5, v)) - 1) / 4;
  const accuracy = norm(output.accuracy);
  const relevance = norm(output.relevance);
  const reasoning = norm(output.reasoning);
  const misconceptions = Math.min(2, output.misconceptions.filter((m) => m.trim()).length);
  let score = 0.55 * coverage + 0.25 * accuracy + 0.1 * reasoning + 0.1 * relevance - 0.1 * misconceptions;
  if (output.relevance <= 2) score = Math.min(score, 0.25);
  score = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  const holistic = Math.max(0, Math.min(1, output.overallScore));
  if (Math.abs(score - holistic) > 0.35) flags.push('score_disagreement');
  return {
    score,
    coverage: Math.round(coverage * 1000) / 1000,
    statuses,
    components: { coverage, accuracy, relevance, reasoning, misconceptions, holistic },
    flags: [...new Set(flags)],
  };
}

/** Open answers count as correct from 0.7: most key points present and no serious error. */
export const OPEN_CORRECT_THRESHOLD = 0.7;
