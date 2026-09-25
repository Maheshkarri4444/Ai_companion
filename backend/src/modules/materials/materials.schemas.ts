import { z } from 'zod';
import { objectIdSchema } from '../../lib/validation';

export const projectScopeParams = z.object({ projectId: objectIdSchema });
export const materialParams = z.object({ projectId: objectIdSchema, materialId: objectIdSchema });

/** Multipart text fields that accompany the file. */
export const uploadFields = z.object({
  title: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const updateMaterialBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
});
