import type { Types } from 'mongoose';
import { Material } from '../models/material.model';
import { Project } from '../models/project.model';
import { emptyStatusCounts, type StatusCounts } from './serializers';

// Aggregation pipelines do not cast types: every id passed here must already be an ObjectId.

/** projectCount per Space. */
export async function projectCountsBySpace(spaceIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (spaceIds.length === 0) return new Map();
  const rows = await Project.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { spaceId: { $in: spaceIds } } },
    { $group: { _id: '$spaceId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/** materialCount per Space. */
export async function materialCountsBySpace(spaceIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (spaceIds.length === 0) return new Map();
  const rows = await Material.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { spaceId: { $in: spaceIds } } },
    { $group: { _id: '$spaceId', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.n]));
}

/** Material status breakdown per Project. */
export async function materialStatusByProject(projectIds: Types.ObjectId[]): Promise<Map<string, StatusCounts>> {
  const result = new Map<string, StatusCounts>();
  if (projectIds.length === 0) return result;
  const rows = await Material.aggregate<{ _id: { projectId: Types.ObjectId; status: keyof StatusCounts }; n: number }>([
    { $match: { projectId: { $in: projectIds } } },
    { $group: { _id: { projectId: '$projectId', status: '$status' }, n: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    const key = row._id.projectId.toString();
    const counts = result.get(key) ?? emptyStatusCounts();
    counts[row._id.status] = row.n;
    result.set(key, counts);
  }
  return result;
}

/** Totals over a material filter: count and bytes, broken down by status. */
export async function materialTotals(match: Record<string, unknown>) {
  const rows = await Material.aggregate<{ _id: keyof StatusCounts; n: number; bytes: number; pages: number }>([
    { $match: match },
    {
      $group: {
        _id: '$status',
        n: { $sum: 1 },
        bytes: { $sum: '$sizeBytes' },
        pages: { $sum: { $ifNull: ['$pageCount', 0] } },
      },
    },
  ]);
  const byStatus = emptyStatusCounts();
  let count = 0;
  let totalBytes = 0;
  let totalPages = 0;
  for (const row of rows) {
    byStatus[row._id] = row.n;
    count += row.n;
    totalBytes += row.bytes;
    totalPages += row.pages;
  }
  return { count, totalBytes, totalPages, byStatus };
}
