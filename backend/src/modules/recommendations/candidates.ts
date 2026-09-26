import type { RecommendationActionType, RecommendationKind } from '../../models/recommendation.model';
import type { AttentionReason, GrowthStatus } from '../growth/classify';

/*
 * Recommendation candidates (PRD §10, docs/ARCHITECTURE.md §19) — pure functions over the learner's state.
 * Each rule turns evidence into a concrete action with the facts that justify it; ranking combines severity,
 * concept importance and novelty (what was dismissed recently is not repeated; what was shown and ignored loses weight).
 */

export interface ConceptState {
  conceptId: string;
  name: string;
  importance: number;
  status: GrowthStatus;
  mastery: number | null;
  delta: number | null;
  reasons: AttentionReason[];
  reasonText: string[];
  severity: number;
  evidenceCount: number;
  lastPracticedAt: Date | null;
  weakLevel: { level: string; accuracy: number } | null;
  source: { materialId: string; materialTitle: string; pages: number[] } | null;
  hasEvidence: boolean;
}

export interface LearnerState {
  projectName: string;
  goal: string;
  materials: { ready: number; pending: number };
  quiz: { activeSessionId: string | null; activeAnswered: number; activeTarget: number; completedCount: number; answered: number };
  tutor: { questions: number };
  concepts: ConceptState[];
  mistakePatterns: Array<{ content: string; conceptIds: string[] }>;
  now: Date;
}

export interface NoveltyInfo {
  /** Keys dismissed in the last 72 h — never recommended again inside that window. */
  dismissed: Set<string>;
  /** Keys shown in earlier batches within 24 h and not acted on — shown again, but with less weight. */
  ignored: Set<string>;
}

export interface Candidate {
  key: string;
  kind: RecommendationKind;
  conceptIds: string[];
  severity: number;
  importance: number;
  priority: number;
  action: { type: RecommendationActionType; params: Record<string, unknown>; label: string };
  facts: Record<string, unknown>;
  title: string;
  rationale: string;
}

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits;
const DAY_MS = 86_400_000;
const pageText = (pages: number[]) => (pages.length === 0 ? '' : pages.length === 1 ? `p. ${pages[0]}` : `pp. ${pages[0]}–${pages[Math.min(pages.length, 3) - 1]}`);

type Draft = Omit<Candidate, 'priority'>;

export function buildCandidates(state: LearnerState): Draft[] {
  const out: Draft[] = [];
  const add = (draft: Omit<Draft, 'key'>) => out.push({ ...draft, key: `${draft.kind}:${[...draft.conceptIds].sort().join(',')}` });

  if (state.materials.ready === 0) {
    if (state.materials.pending === 0) {
      add({
        kind: 'upload_material',
        conceptIds: [],
        severity: 1,
        importance: 1,
        action: { type: 'upload_material', params: {}, label: 'Upload material' },
        facts: { readyMaterials: 0 },
        title: 'Add your first study material',
        rationale: 'Upload a PDF of your notes or a chapter — Zoya’s answers and your quizzes are built from it.',
      });
    }
    return out;
  }

  if (state.quiz.activeSessionId) {
    add({
      kind: 'resume_quiz',
      conceptIds: [],
      severity: 0.95,
      importance: 1,
      action: { type: 'resume_quiz', params: { sessionId: state.quiz.activeSessionId }, label: 'Resume quiz' },
      facts: { answered: state.quiz.activeAnswered, total: state.quiz.activeTarget },
      title: 'Finish your quiz in progress',
      rationale: `You have answered ${state.quiz.activeAnswered} of ${state.quiz.activeTarget} questions — finishing it updates your mastery.`,
    });
  }

  const byId = new Map(state.concepts.map((c) => [c.conceptId, c]));
  for (const pattern of state.mistakePatterns.slice(0, 2)) {
    const concept = pattern.conceptIds.map((id) => byId.get(id)).find(Boolean);
    if (!concept) continue;
    add({
      kind: 'fix_repeated_mistake',
      conceptIds: [concept.conceptId],
      severity: 0.9,
      importance: concept.importance,
      action: {
        type: 'ask_tutor',
        params: { prompt: `I keep making the same mistake with ${concept.name}: ${pattern.content}. Can you explain it step by step?` },
        label: 'Ask Zoya',
      },
      facts: { concept: concept.name, pattern: pattern.content, mastery: pct(concept.mastery) },
      title: `Clear up a repeated mistake in ${concept.name}`,
      rationale: `A pattern showed up in your answers: ${pattern.content}. Zoya can walk you through it with your notes.`,
    });
  }

  const attention = state.concepts.filter((c) => c.status === 'attention').sort((a, b) => b.severity - a.severity);
  for (const c of attention.slice(0, 3)) {
    const pages = c.source ? pageText(c.source.pages) : '';
    add({
      kind: 'review_weak_concept',
      conceptIds: [c.conceptId],
      severity: c.severity,
      importance: c.importance,
      action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: [c.conceptId], targetCount: 3, questionTypes: 'mixed' }, label: 'Practise 3 questions' },
      facts: {
        concept: c.name,
        mastery: pct(c.mastery),
        reasons: c.reasonText,
        material: c.source?.materialTitle ?? null,
        materialId: c.source?.materialId ?? null,
        firstPage: c.source?.pages[0] ?? null,
        pages,
      },
      title: `Review ${c.name}, then take a short quiz`,
      rationale: `${c.name} is at ${pct(c.mastery)} (${c.reasonText.join('; ')}).${c.source && pages ? ` Re-read ${c.source.materialTitle} ${pages},` : ''} then check yourself with 3 focused questions.`,
    });
  }

  for (const c of state.concepts.filter((x) => x.status === 'improving' && x.weakLevel && ['apply', 'analyze'].includes(x.weakLevel.level)).slice(0, 1)) {
    add({
      kind: 'practice_application',
      conceptIds: [c.conceptId],
      severity: 0.6,
      importance: c.importance,
      action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: [c.conceptId], targetCount: 4, questionTypes: 'mixed' }, label: 'Practise applying it' },
      facts: { concept: c.name, mastery: pct(c.mastery), weakLevel: c.weakLevel!.level, weakLevelAccuracy: pct(c.weakLevel!.accuracy) },
      title: `Practise applying ${c.name}`,
      rationale: `Your understanding of ${c.name} improved to ${pct(c.mastery)}, but ${c.weakLevel!.level} questions remain difficult (${pct(c.weakLevel!.accuracy)} correct).`,
    });
  }

  const stale = state.concepts
    .filter((c) => c.status !== 'attention' && c.mastery !== null && c.mastery >= 0.5 && c.lastPracticedAt && state.now.getTime() - new Date(c.lastPracticedAt).getTime() > 7 * DAY_MS)
    .sort((a, b) => new Date(a.lastPracticedAt!).getTime() - new Date(b.lastPracticedAt!).getTime());
  if (stale.length) {
    const picked = stale.slice(0, 3);
    const days = Math.round((state.now.getTime() - new Date(picked[0].lastPracticedAt!).getTime()) / DAY_MS);
    add({
      kind: 'spaced_review',
      conceptIds: picked.map((c) => c.conceptId),
      severity: 0.45,
      importance: Math.max(...picked.map((c) => c.importance)),
      action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: picked.map((c) => c.conceptId), targetCount: 3, questionTypes: 'mcq' }, label: 'Quick review' },
      facts: { concepts: picked.map((c) => c.name), daysSincePractice: days },
      title: `Refresh ${picked[0].name}${picked.length > 1 ? ` and ${picked.length - 1} more` : ''}`,
      rationale: `You haven't practised ${picked.map((c) => c.name).join(', ')} for ${days} days — a quick review keeps it from fading.`,
    });
  }

  const unassessed = state.concepts.filter((c) => c.status === 'not_assessed' && c.hasEvidence).sort((a, b) => b.importance - a.importance);
  if (state.quiz.completedCount === 0 && !state.quiz.activeSessionId) {
    add({
      kind: 'first_quiz',
      conceptIds: [],
      severity: 0.8,
      importance: 1,
      action: { type: 'start_quiz', params: { mode: 'adaptive', targetCount: 5, questionTypes: 'mixed' }, label: 'Start a 5-question quiz' },
      facts: { concepts: state.concepts.length, tutorQuestions: state.tutor.questions },
      title: 'Take your first quiz',
      rationale: `Your materials cover ${state.concepts.length} concepts. A short adaptive quiz shows what you already know and where to focus.`,
    });
  } else if (unassessed.length) {
    const picked = unassessed.slice(0, 3);
    add({
      kind: 'assess_new_concepts',
      conceptIds: picked.map((c) => c.conceptId),
      severity: round(0.4 + 0.3 * Math.min(1, unassessed.length / Math.max(1, state.concepts.length))),
      importance: Math.max(...picked.map((c) => c.importance)),
      action: { type: 'start_quiz', params: { mode: 'focused', conceptIds: picked.map((c) => c.conceptId), targetCount: Math.max(3, picked.length), questionTypes: 'mixed' }, label: 'Check these concepts' },
      facts: { concepts: picked.map((c) => c.name), unassessed: unassessed.length, total: state.concepts.length },
      title: `Check your understanding of ${picked[0].name}${picked.length > 1 ? ` and ${picked.length - 1} more` : ''}`,
      rationale: `${unassessed.length} of ${state.concepts.length} concepts have not been assessed yet, including ${picked.map((c) => c.name).join(', ')}.`,
    });
  }

  if (state.tutor.questions === 0) {
    const top = [...state.concepts].sort((a, b) => b.importance - a.importance)[0];
    if (top) {
      add({
        kind: 'ask_tutor',
        conceptIds: [top.conceptId],
        severity: 0.55,
        importance: top.importance,
        action: { type: 'ask_tutor', params: { prompt: `Explain ${top.name} with an example` }, label: 'Ask Zoya' },
        facts: { concept: top.name },
        title: `Ask Zoya to explain ${top.name}`,
        rationale: `Get a clear explanation of ${top.name} with page citations from your own materials.`,
      });
    }
  }

  const assessed = state.concepts.filter((c) => c.mastery !== null);
  if (assessed.length >= 2 && !attention.length && assessed.every((c) => (c.mastery ?? 0) >= 0.8)) {
    add({
      kind: 'stretch_challenge',
      conceptIds: [],
      severity: 0.35,
      importance: 1,
      action: { type: 'start_quiz', params: { mode: 'adaptive', targetCount: 5, questionTypes: 'open' }, label: 'Try written questions' },
      facts: { strongConcepts: assessed.length },
      title: 'Challenge yourself with written answers',
      rationale: `All ${assessed.length} assessed concepts are strong. Written questions check deeper understanding and application.`,
    });
  }
  return out;
}

/** severity × (0.5 + 0.5·importance) × novelty — at most two of a kind, top `limit`. */
export function rankCandidates(drafts: Draft[], novelty: NoveltyInfo, limit = 3): Candidate[] {
  const ranked = drafts
    .filter((d) => !novelty.dismissed.has(d.key))
    .map((d) => ({ ...d, priority: round(d.severity * (0.5 + 0.5 * d.importance) * (novelty.ignored.has(d.key) ? 0.7 : 1)) }))
    .sort((a, b) => b.priority - a.priority);
  const picked: Candidate[] = [];
  const perKind = new Map<string, number>();
  for (const c of ranked) {
    const n = perKind.get(c.kind) ?? 0;
    if (n >= 2) continue;
    perKind.set(c.kind, n + 1);
    picked.push(c);
    if (picked.length >= limit) break;
  }
  return picked;
}
