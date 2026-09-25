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

export type UsersQuery = z.infer<typeof usersQuery>;
export type SpacesQuery = z.infer<typeof spacesQuery>;
export type ProjectsQuery = z.infer<typeof projectsQuery>;
export type MaterialsQuery = z.infer<typeof materialsQuery>;
export type ActivityQuery = z.infer<typeof activityQuery>;
