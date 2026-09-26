import { z } from 'zod';
import {
  blankToUndefined,
  objectIdSchema,
  optionalEnum,
  optionalObjectId,
  paginationSchema,
  searchSchema,
} from '../../lib/validation';
import { ACTIVITY_TYPES } from '../../models/activityEvent.model';
import { EVAL_SUBJECTS, EVALUATORS } from '../../models/aiEvaluation.model';
import { JOB_STATUSES } from '../../models/job.model';
import { MATERIAL_STATUSES } from '../../models/material.model';
import { ROLES } from '../../models/user.model';

const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());

export const userParams = z.object({ userId: objectIdSchema });
export const adminMaterialParams = z.object({ materialId: objectIdSchema });

export const usersQuery = paginationSchema.extend({
  search: searchSchema,
  role: optionalEnum(ROLES),
});

export const spacesQuery = paginationSchema.extend({
  search: searchSchema,
  userId: optionalObjectId,
});

export const projectsQuery = paginationSchema.extend({
  search: searchSchema,
  userId: optionalObjectId,
  spaceId: optionalObjectId,
});

export const materialsQuery = paginationSchema.extend({
  search: searchSchema,
  userId: optionalObjectId,
  spaceId: optionalObjectId,
  projectId: optionalObjectId,
  status: optionalEnum(MATERIAL_STATUSES),
});

export const activityQuery = paginationSchema
  .extend({
    userId: optionalObjectId,
    spaceId: optionalObjectId,
    projectId: optionalObjectId,
    type: optionalEnum(ACTIVITY_TYPES),
    from: optionalDate,
    to: optionalDate,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be before "to"', path: ['from'] });

export const rangeQuery = z.object({ range: z.enum(['24h', '7d', '30d']).default('7d') });
/** Analytics ranges (days): engagement and learning trends need longer windows than operational views. */
export const analyticsRangeQuery = z.object({ range: z.enum(['7d', '30d', '90d']).default('30d') });

const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const aiCallsQuery = paginationSchema.extend({
  feature: optionalText(60),
  model: optionalText(80),
  status: optionalEnum(['success', 'error'] as const),
  userId: optionalObjectId,
  projectId: optionalObjectId,
  traceId: optionalText(100),
});

export const evaluationsQuery = paginationSchema.extend({
  evaluator: optionalEnum(EVALUATORS),
  verdict: optionalEnum(['pass', 'warn', 'fail'] as const),
  subjectType: optionalEnum(EVAL_SUBJECTS),
  userId: optionalObjectId,
});

export const jobsQuery = paginationSchema.extend({
  type: optionalText(60),
  status: optionalEnum(JOB_STATUSES),
  userId: optionalObjectId,
});

export const idParams = (name: string) => z.object({ [name]: objectIdSchema });

export type RangeQuery = z.infer<typeof rangeQuery>;
export type AiCallsQuery = z.infer<typeof aiCallsQuery>;
export type EvaluationsQuery = z.infer<typeof evaluationsQuery>;
export type JobsQuery = z.infer<typeof jobsQuery>;
export type UsersQuery = z.infer<typeof usersQuery>;
export type SpacesQuery = z.infer<typeof spacesQuery>;
export type ProjectsQuery = z.infer<typeof projectsQuery>;
export type MaterialsQuery = z.infer<typeof materialsQuery>;
export type ActivityQuery = z.infer<typeof activityQuery>;
