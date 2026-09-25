import { z } from 'zod';
import { objectIdSchema } from '../../lib/validation';
import { PROJECT_STATUSES } from '../../models/project.model';

const fields = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().min(1, 'Description is required').max(1000),
  learningGoal: z.string().trim().min(1, 'Learning goal is required').max(500),
};

export const projectParams = z.object({ projectId: objectIdSchema });

export const createProjectBody = z.object(fields);

export const updateProjectBody = z
  .object({ ...fields, status: z.enum(PROJECT_STATUSES) })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to update');

export const recentProjectsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export type CreateProjectInput = z.infer<typeof createProjectBody>;
export type UpdateProjectInput = z.infer<typeof updateProjectBody>;
