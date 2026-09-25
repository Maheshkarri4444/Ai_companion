import { Types } from 'mongoose';
import { z } from 'zod';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Query-string helper: `?userId=` (blank) means "no filter" rather than an invalid id. */
export const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const optionalObjectId = z.preprocess(blankToUndefined, objectIdSchema.optional());

export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(blankToUndefined, z.enum(values).optional());
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Optional free-text search: trimmed, bounded, blank → undefined. */
export const searchSchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((v) => (v ? v : undefined));

export function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export function isObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/** Escape user input before embedding it in a MongoDB `$regex`. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
