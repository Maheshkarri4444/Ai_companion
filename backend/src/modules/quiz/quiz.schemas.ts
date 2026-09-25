import { z } from 'zod';
import { objectIdSchema } from '../../lib/validation';
import { OPTION_IDS, QUESTION_TYPE_PREFERENCES, QUIZ_MODES } from '../../models/quiz.model';

export const projectParams = z.object({ projectId: objectIdSchema });
export const sessionParams = projectParams.extend({ sessionId: objectIdSchema });
export const questionParams = sessionParams.extend({ questionId: objectIdSchema });

export const startQuizBody = z
  .object({
    mode: z.enum(QUIZ_MODES).default('adaptive'),
    targetCount: z.coerce.number().int().min(3, 'At least 3 questions').max(15, 'At most 15 questions').default(5),
    questionTypes: z.enum(QUESTION_TYPE_PREFERENCES).default('mixed'),
    conceptIds: z.array(objectIdSchema).max(8).default([]),
  })
  .refine((body) => body.mode !== 'focused' || body.conceptIds.length > 0, { message: 'Choose at least one concept to focus on', path: ['conceptIds'] });

export const answerBody = z.object({
  /** Client-generated; resubmitting the same key replays the stored result instead of answering twice. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid idempotencyKey'),
  optionId: z.enum(OPTION_IDS).optional(),
  text: z
    .string()
    .max(4000, 'Answers are limited to 4000 characters')
    .refine((s) => !/\u0000/.test(s), 'Invalid characters')
    .optional(),
  /** "I don't know" — graded 0 without a model call, and the full answer is shown. */
  skipped: z.boolean().optional(),
  timeMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(),
});

export const reportBody = z.object({
  target: z.enum(['question', 'grading']),
  reason: z.enum(['wrong_answer_key', 'unclear', 'not_in_materials', 'too_easy', 'too_hard', 'unfair_grade', 'other']),
  comment: z.string().trim().max(500).optional(),
});
