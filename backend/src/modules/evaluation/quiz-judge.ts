import { z } from 'zod';
import { ai } from '../../ai';
import { QUIZ_JUDGE_PROMPT } from '../../ai/prompts/quiz';
import { JobError } from '../../jobs/queue';
import { escapePromptData, truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { Chunk } from '../../models/knowledge.model';
import { Question } from '../../models/quiz.model';
import { recordEvaluation } from './evaluation.service';

const ISSUES = ['ambiguous', 'multiple_correct', 'answer_leak', 'outside_knowledge', 'factual_error'];

const Judgement = z.object({
  answerable: z.number().int().min(1).max(5),
  keyCorrect: z.number().int().min(1).max(5),
  distractors: z.number().int().min(1).max(5),
  clarity: z.number().int().min(1).max(5),
  difficultyMatch: z.number().int().min(1).max(5),
  levelMatch: z.number().int().min(1).max(5),
  issues: z.array(z.string()),
  verdict: z.enum(['pass', 'warn', 'fail']),
  rationale: z.string(),
});

const norm = (score: number) => (score - 1) / 4;

/**
 * LLM judge for a generated question (sampled, every question with rule warnings, every learner report):
 * answerable from the sources alone, correct answer key, distractor / rubric quality, clarity, and whether it
 * matches the difficulty and cognitive level the adaptive engine asked for (PRD §14 "question quality").
 */
export async function judgeQuizQuestion(questionId: string, ctx: { jobId: string; signal: AbortSignal }) {
  const question = await Question.findById(toObjectId(questionId)).lean();
  if (!question) return { skipped: 'question-deleted' };

  const chunkIds = question.sources.map((s) => s.chunkId).filter((id) => id !== null);
  const chunks = chunkIds.length ? await Chunk.find({ _id: { $in: chunkIds }, ownerId: question.ownerId }, { text: 1 }).lean() : [];
  const textOf = new Map(chunks.map((c) => [c._id.toString(), c.text]));
  const sources = question.sources
    .map(
      (s) =>
        `<source id="${s.ref}" material="${escapePromptData(s.materialTitle).replace(/"/g, "'")}" page="${s.pageStart}">\n${escapePromptData(truncate((s.chunkId && textOf.get(s.chunkId.toString())) || s.snippet, 2000))}\n</source>`,
    )
    .join('\n');
  const item =
    question.type === 'mcq'
      ? [
          `Question: ${question.stem}`,
          ...question.options.map((o) => `${o.id}. ${o.text}${o.id === question.correctOptionId ? '   ← keyed correct answer' : ''}`),
          `Explanation: ${question.explanation}`,
        ].join('\n')
      : [
          `Question: ${question.stem}`,
          `Key points: ${(question.rubric?.keyPoints ?? []).map((p, i) => `(${i + 1}) ${p}`).join(' ')}`,
          `Model answer: ${question.rubric?.sampleAnswer ?? ''}`,
          `Explanation: ${question.explanation}`,
        ].join('\n');

  const result = await ai().structured({
    feature: 'eval.judge',
    tier: 'primary',
    reasoning: 'low',
    promptVersion: QUIZ_JUDGE_PROMPT.version,
    system: QUIZ_JUDGE_PROMPT.system,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: QUIZ_JUDGE_PROMPT.build({
              type: question.type,
              difficulty: question.difficulty,
              level: question.cognitiveLevel,
              item: escapePromptData(item),
              sources: `<sources>\n${sources}\n</sources>`,
            }),
          },
        ],
      },
    ],
    schema: Judgement,
    meta: { ownerId: question.ownerId.toString(), projectId: question.projectId.toString(), jobId: ctx.jobId },
    signal: ctx.signal,
    timeoutMs: 45_000,
    inputPreview: `Judge question: ${truncate(question.stem, 200)}`,
  });
  const j = result.data;
  const issues = j.issues.map((i) => i.trim().toLowerCase()).filter((i) => ISSUES.includes(i));
  const evaluation = await recordEvaluation({
    subjectType: 'quiz_question',
    subjectId: question._id,
    evaluator: 'llm_judge',
    feature: 'quiz.generate',
    ownerId: question.ownerId,
    projectId: question.projectId,
    scores: {
      answerable: norm(j.answerable),
      keyCorrect: norm(j.keyCorrect),
      distractors: norm(j.distractors),
      clarity: norm(j.clarity),
      difficultyMatch: norm(j.difficultyMatch),
      levelMatch: norm(j.levelMatch),
    },
    verdict: issues.includes('multiple_correct') || issues.includes('factual_error') || j.keyCorrect <= 2 ? 'fail' : j.verdict,
    flags: issues,
    rationale: truncate(j.rationale, 400),
    inputPreview: `${question.conceptNames[0] ?? 'Concept'} · ${question.type} · difficulty ${question.difficulty} · ${question.cognitiveLevel}`,
    outputPreview: question.stem,
    aiCallId: result.aiCallId,
    promptVersion: question.generation?.promptVersion ?? null,
    model: question.generation?.model ?? null,
  });
  if (!evaluation) throw new JobError('EVAL_NOT_RECORDED', 'Evaluation could not be stored', true);
  return { verdict: evaluation.verdict, keyCorrect: j.keyCorrect, answerable: j.answerable };
}
