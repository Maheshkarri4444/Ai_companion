import { z } from 'zod';
import { blankToUndefined, objectIdSchema } from '../../lib/validation';
import { TUTOR_ACTIONS } from './understand';

export const projectParams = z.object({ projectId: objectIdSchema });
export const conversationParams = projectParams.extend({ conversationId: objectIdSchema });
export const messageParams = projectParams.extend({ messageId: objectIdSchema });
export const memoryParams = projectParams.extend({ itemId: objectIdSchema });

const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());

export const conversationsQuery = z.object({
  before: optionalDate,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const messagesQuery = z.object({
  before: optionalDate,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageBody = z.object({
  conversationId: objectIdSchema.optional(),
  /** Client-generated; resending the same id is idempotent. */
  clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid clientMessageId'),
  content: z
    .string()
    .trim()
    .min(1, 'Type a message')
    .max(4000, 'Messages are limited to 4000 characters')
    .refine((s) => !/\u0000/.test(s), 'Invalid characters'),
  mode: z.enum(['auto', 'general']).default('auto'),
  action: z.enum(TUTOR_ACTIONS).nullish().transform((v) => v ?? null),
});
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const renameConversationBody = z.object({ title: z.string().trim().min(1).max(80) });

export const feedbackBody = z.object({
  rating: z.enum(['up', 'down']),
  reason: z.enum(['incorrect', 'not_grounded', 'wrong_citation', 'unclear', 'too_long', 'too_short', 'helpful', 'other']).optional(),
  comment: z.string().trim().max(500).optional(),
});
