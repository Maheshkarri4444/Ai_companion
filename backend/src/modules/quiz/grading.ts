import { z } from 'zod';
import { ai, type CallMeta } from '../../ai';
import { QUIZ_GRADE_PROMPT } from '../../ai/prompts/quiz';
import { escapePromptData, truncate } from '../../lib/text';
import type { IAttemptFeedback, IQuestion } from '../../models/quiz.model';
import { sourcesBlock, type EvidencePassage } from './generation';
import { looksLikeGradeManipulation, OPEN_CORRECT_THRESHOLD, scoreOpenAnswer, type GradeOutput } from './validation';

/*
 * Evaluating answers (PRD §9): multiple choice is graded exactly; open-ended answers are graded by the model
 * against the question's rubric and the source passages, and the score is computed from its verdicts
 * (validation.ts). Feedback always says what was understood and what is missing — never just a number.
 */

export interface GradeResult {
  outcome: number;
  isCorrect: boolean;
  feedback: IAttemptFeedback;
  method: 'exact' | 'ai' | 'rule';
  scores: Record<string, number> | null;
  flags: string[];
  aiCallId: string | null;
  model: string | null;
  promptVersion: string | null;
}

const clip = (items: string[], max = 3, chars = 240) =>
  items
    .map((i) => truncate(i.replace(/\s+/g, ' ').trim(), chars))
    .filter(Boolean)
    .slice(0, max);

export function gradeMcq(question: Pick<IQuestion, 'options' | 'correctOptionId'>, optionId: string): GradeResult {
  const correct = question.options.find((o) => o.id === question.correctOptionId);
  const chosen = question.options.find((o) => o.id === optionId);
  const isCorrect = Boolean(chosen && correct && chosen.id === correct.id);
  return {
    outcome: isCorrect ? 1 : 0,
    isCorrect,
    method: 'exact',
    scores: null,
    flags: [],
    aiCallId: null,
    model: null,
    promptVersion: null,
    feedback: {
      summary: isCorrect ? 'Correct!' : `Not quite — the correct answer is ${correct?.id ?? '?'}.`,
      understood: isCorrect && correct?.rationale ? [correct.rationale] : [],
      missing: !isCorrect && correct ? [`${correct.id}. ${correct.text}${correct.rationale ? ` — ${correct.rationale}` : ''}`] : [],
      // Why the chosen option is wrong: the misunderstanding the distractor was written to catch.
      misconceptions: !isCorrect && chosen?.rationale ? [`${chosen.id}. ${chosen.rationale}`] : [],
      keyPoints: [],
    },
  };
}

/** "I don't know" / empty: no model call, score 0, and the full answer as feedback (a learning moment). */
export function gradeNonAnswer(question: Pick<IQuestion, 'type' | 'options' | 'correctOptionId' | 'rubric'>): GradeResult {
  const correct = question.options.find((o) => o.id === question.correctOptionId);
  const keyPoints = question.rubric?.keyPoints ?? [];
  return {
    outcome: 0,
    isCorrect: false,
    method: 'rule',
    scores: null,
    flags: ['no_answer'],
    aiCallId: null,
    model: null,
    promptVersion: null,
    feedback: {
      summary: "No problem — not knowing yet is part of learning. Here's what a complete answer includes.",
      understood: [],
      missing: question.type === 'mcq' && correct ? [`${correct.id}. ${correct.text}`] : keyPoints,
      misconceptions: [],
      keyPoints: keyPoints.map((point) => ({ point, status: 'missing' as const, evidence: '' })),
    },
  };
}

const GradeSchema = z.object({
  keyPoints: z.array(z.object({ id: z.string(), status: z.enum(['covered', 'partial', 'missing']), evidence: z.string() })),
  accuracy: z.number().int().min(1).max(5),
  relevance: z.number().int().min(1).max(5),
  reasoning: z.number().int().min(1).max(5),
  misconceptions: z.array(z.string()),
  understood: z.array(z.string()),
  missing: z.array(z.string()),
  feedback: z.string(),
  overallScore: z.number().min(0).max(1),
});

/** Grades a written answer; throws AIError when no model can (the caller keeps the answer as "pending"). */
export async function gradeOpenAnswer(input: {
  question: Pick<IQuestion, 'stem' | 'cognitiveLevel' | 'rubric' | 'conceptNames'>;
  answer: string;
  sources: EvidencePassage[];
  meta?: CallMeta;
  signal?: AbortSignal;
}): Promise<GradeResult> {
  const keyPoints = input.question.rubric?.keyPoints ?? [];
  const flagged = looksLikeGradeManipulation(input.answer);
  const result = await ai().structured({
    feature: 'quiz.grade',
    // Grading must be at least as capable as generation; the light tier is too lenient for rubric judgements.
    tier: 'primary',
    reasoning: 'low',
    promptVersion: QUIZ_GRADE_PROMPT.version,
    system: QUIZ_GRADE_PROMPT.system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: QUIZ_GRADE_PROMPT.build({
              stem: escapePromptData(input.question.stem),
              level: input.question.cognitiveLevel,
              keyPoints: keyPoints.map((p) => escapePromptData(p)),
              sampleAnswer: escapePromptData(input.question.rubric?.sampleAnswer ?? ''),
              sources: sourcesBlock(input.sources, 1800),
              answer: escapePromptData(truncate(input.answer, 4000)),
              flagged,
            }),
          },
        ],
      },
    ],
    schema: GradeSchema,
    meta: input.meta,
    signal: input.signal,
    timeoutMs: 30_000,
    inputPreview: `Grade: ${truncate(input.answer, 200)}`,
    metadata: { concept: input.question.conceptNames[0] ?? null, keyPoints: keyPoints.length, flagged },
  });
  const output = result.data as GradeOutput;
  const scored = scoreOpenAnswer(output, keyPoints.length, input.answer);
  return {
    outcome: scored.score,
    isCorrect: scored.score >= OPEN_CORRECT_THRESHOLD,
    method: 'ai',
    scores: {
      score: scored.score,
      coverage: scored.coverage,
      accuracy: output.accuracy,
      relevance: output.relevance,
      reasoning: output.reasoning,
      holistic: Math.round(scored.components.holistic * 100) / 100,
    },
    flags: [...scored.flags, ...(flagged ? ['answer_flagged'] : [])],
    aiCallId: result.aiCallId,
    model: result.model,
    promptVersion: QUIZ_GRADE_PROMPT.version,
    feedback: {
      summary: truncate(output.feedback.trim(), 600) || (scored.score >= OPEN_CORRECT_THRESHOLD ? 'Good answer.' : 'Some key points are missing.'),
      understood: clip(output.understood),
      missing: clip(output.missing),
      misconceptions: clip(output.misconceptions),
      keyPoints: keyPoints.map((point, i) => ({
        point,
        status: scored.statuses[i]?.status ?? 'missing',
        evidence: truncate(scored.statuses[i]?.evidence ?? '', 240),
      })),
    },
  };
}
