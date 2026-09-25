import { z } from 'zod';
import { SPACE_COLORS, SPACE_ICONS } from '../../lib/constants';
import { objectIdSchema } from '../../lib/validation';

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().min(1, 'Description is required').max(500),
  color: z.enum(SPACE_COLORS),
  icon: z.enum(SPACE_ICONS),
};

export const spaceParams = z.object({ spaceId: objectIdSchema });

export const createSpaceBody = z.object({
  ...fields,
  color: fields.color.default('blue'),
  icon: fields.icon.default('book'),
});

// Built from the raw fields (no defaults), so a partial update never resets an omitted field.
export const updateSpaceBody = z
  .object(fields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');

export type CreateSpaceInput = z.infer<typeof createSpaceBody>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceBody>;
