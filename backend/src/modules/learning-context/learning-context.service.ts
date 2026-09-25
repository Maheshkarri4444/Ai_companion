import { Types } from 'mongoose';
import { ai, AIError, type CallMeta } from '../../ai';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { truncate } from '../../lib/text';
import { toObjectId } from '../../lib/validation';
import { dot } from '../../lib/vector';
import {
  LearningContext,
  type ILearningContext,
  type LearningKind,
  type LearningSource,
} from '../../models/learningContext.model';

/*
 * Persistent learning context (PRD §11, docs/ARCHITECTURE.md §15). This module is the single write/read
 * path: the Tutor writes observations today; the quiz, mastery and recommendation workflows write theirs
 * (weaknesses, repeated mistakes, milestones) through the same `rememberLearning` call.
 */

const DUPLICATE_SIMILARITY = 0.88;
const MAX_ACTIVE_PER_PROJECT = 60;
const RECENCY_HALF_LIFE_DAYS = 21;
/** Kinds that are useful in almost every tutoring response, regardless of the question. */
const ALWAYS_RELEVANT: LearningKind[] = ['goal', 'preference'];

export interface RememberItem {
  kind: LearningKind;
  content: string;
  /** 0–1; defaults per kind. */
  salience?: number;
  conceptIds?: string[];
  /** Preferences may apply across Projects ("prefers short answers"); everything else stays in its Project. */
  scope?: 'project' | 'user';
}

export interface LearningItemDto {
  id: string;
  kind: LearningKind;
  content: string;
  scope: 'project' | 'user';
  salience: number;
  evidenceCount: number;
  source: LearningSource;
  status: string;
  lastObservedAt: Date;
  createdAt: Date;
}

const DEFAULT_SALIENCE: Record<LearningKind, number> = {
  goal: 0.8,
  preference: 0.7,
  weakness: 0.7,
  misconception: 0.75,
  mistake_pattern: 0.8,
  strength: 0.5,
  interest: 0.45,
  milestone: 0.4,
  note: 0.4,
};

export function toLearningItemDto(item: ILearningContext): LearningItemDto {
  return {
    id: item._id.toString(),
    kind: item.kind,
    content: item.content,
    scope: item.scope,
    salience: Math.round(item.salience * 100) / 100,
    evidenceCount: item.evidenceCount,
    source: item.source?.type ?? 'tutor',
    status: item.status,
    lastObservedAt: item.lastObservedAt,
    createdAt: item.createdAt,
  };
}

const recency = (date: Date) => Math.pow(0.5, (Date.now() - new Date(date).getTime()) / (RECENCY_HALF_LIFE_DAYS * 86_400_000));

function scopeFilter(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  return { ownerId, $or: [{ projectId }, { scope: 'user' as const }] };
}

/**
 * Adds observations, reinforcing near-duplicates instead of storing them twice ("struggles with the chain
 * rule" seen three times becomes one item with evidenceCount 3 and higher salience). Bounded per Project.
 */
export async function rememberLearning(input: {
  ownerId: string | Types.ObjectId;
  projectId: string | Types.ObjectId;
  items: RememberItem[];
  source: { type: LearningSource; refId?: string | null };
  meta?: CallMeta;
  signal?: AbortSignal;
}): Promise<{ created: number; reinforced: number }> {
  const ownerId = new Types.ObjectId(input.ownerId.toString());
  const projectId = new Types.ObjectId(input.projectId.toString());
  const items = input.items
    .map((i) => ({ ...i, content: truncate(i.content.replace(/\s+/g, ' ').trim(), 400) }))
    .filter((i) => i.content.length >= 4)
    .slice(0, 10);
  if (items.length === 0) return { created: 0, reinforced: 0 };

  let vectors: number[][] = [];
  try {
    vectors = await ai().embed(
      items.map((i) => `${i.kind}: ${i.content}`),
      { feature: 'embed.memory', taskType: 'RETRIEVAL_DOCUMENT', meta: input.meta, signal: input.signal },
    );
  } catch (err) {
    if (err instanceof AIError && err.kind === 'aborted') throw err;
    // Store without vectors: still listed and recalled by salience/recency, just not by similarity.
    logger.warn({ err: (err as Error).message }, 'Learning-context embedding failed; storing without vectors');
  }

  const existing = await LearningContext.find({ ...scopeFilter(ownerId, projectId), status: 'active' })
    .select('+embedding')
    .lean();

  let created = 0;
  let reinforced = 0;
  for (const [i, item] of items.entries()) {
    const vector = vectors[i] ?? [];
    const duplicate = existing
      .filter((e) => e.kind === item.kind || (e.embedding?.length && vector.length && dot(e.embedding, vector) >= 0.95))
      .map((e) => ({
        e,
        score:
          e.content.toLowerCase() === item.content.toLowerCase()
            ? 1
            : e.embedding?.length && vector.length
              ? dot(e.embedding, vector)
              : 0,
      }))
      .filter((x) => x.score >= DUPLICATE_SIMILARITY)
      .sort((a, b) => b.score - a.score)[0]?.e;

    const salience = item.salience ?? DEFAULT_SALIENCE[item.kind];
    if (duplicate) {
      await LearningContext.updateOne(
        { _id: duplicate._id },
        {
          $set: {
            lastObservedAt: new Date(),
            salience: Math.min(1, Math.max(duplicate.salience, salience) + 0.05),
            // The newest phrasing is usually the most precise.
            content: item.content,
            ...(vector.length ? { embedding: vector } : {}),
          },
          $inc: { evidenceCount: 1 },
          $addToSet: { conceptIds: { $each: (item.conceptIds ?? []).map(toObjectId) } },
        },
      );
      reinforced++;
      continue;
    }
    const scope = item.scope === 'user' && item.kind === 'preference' ? 'user' : 'project';
    const doc = await LearningContext.create({
      ownerId,
      projectId: scope === 'user' ? null : projectId,
      scope,
      kind: item.kind,
      content: item.content,
      embedding: vector,
      salience,
      conceptIds: (item.conceptIds ?? []).map(toObjectId),
      source: { type: input.source.type, refId: input.source.refId ?? null },
      lastObservedAt: new Date(),
    });
    existing.push({ ...doc.toObject(), embedding: vector });
    created++;
  }

  await enforceCap(ownerId, projectId);
  return { created, reinforced };
}

/** Keeps the active set small and relevant: the weakest, stalest observations are archived (goals never). */
async function enforceCap(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  const active = await LearningContext.find({ ownerId, projectId, status: 'active' }, { kind: 1, salience: 1, lastObservedAt: 1 }).lean();
  if (active.length <= MAX_ACTIVE_PER_PROJECT) return;
  const evictable = active
    .filter((a) => a.kind !== 'goal')
    .map((a) => ({ id: a._id, keep: a.salience * 0.6 + recency(a.lastObservedAt) * 0.4 }))
    .sort((a, b) => a.keep - b.keep)
    .slice(0, active.length - MAX_ACTIVE_PER_PROJECT);
  if (evictable.length) {
    await LearningContext.updateMany({ _id: { $in: evictable.map((e) => e.id) } }, { $set: { status: 'archived' } });
  }
}

/**
 * Relevance-ranked recall for one AI request: 0.5·similarity + 0.3·salience + 0.2·recency, plus the few
 * always-relevant items (goals, preferences). Returns nothing from other Projects.
 */
export async function recallLearning(input: {
  ownerId: string;
  projectId: string;
  query?: string;
  limit?: number;
  kinds?: LearningKind[];
  meta?: CallMeta;
  signal?: AbortSignal;
}): Promise<Array<LearningItemDto & { relevance: number }>> {
  const ownerId = toObjectId(input.ownerId);
  const projectId = toObjectId(input.projectId);
  const limit = input.limit ?? 6;
  const filter: Record<string, unknown> = { ...scopeFilter(ownerId, projectId), status: 'active' };
  if (input.kinds?.length) filter.kind = { $in: input.kinds };
  const items = await LearningContext.find(filter).select('+embedding').limit(200).lean();
  if (items.length === 0) return [];

  let queryVector: number[] | null = null;
  if (input.query?.trim()) {
    try {
      [queryVector] = await ai().embed([input.query], { feature: 'embed.query', taskType: 'RETRIEVAL_QUERY', meta: input.meta, signal: input.signal });
    } catch (err) {
      if (err instanceof AIError && err.kind === 'aborted') throw err;
      queryVector = null; // degrade to salience + recency
    }
  }

  const scored = items.map((item) => {
    const similarity = queryVector && item.embedding?.length ? Math.max(0, dot(item.embedding, queryVector)) : 0;
    const relevance = queryVector
      ? 0.5 * similarity + 0.3 * item.salience + 0.2 * recency(item.lastObservedAt)
      : 0.6 * item.salience + 0.4 * recency(item.lastObservedAt);
    return { item, similarity, relevance };
  });

  const always = scored
    .filter((s) => ALWAYS_RELEVANT.includes(s.item.kind))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3);
  const alwaysIds = new Set(always.map((s) => s.item._id.toString()));
  // Below this similarity an item is unrelated to the request — relevance over volume.
  const rest = scored
    .filter((s) => !alwaysIds.has(s.item._id.toString()) && (!queryVector || s.similarity >= 0.3 || s.item.salience >= 0.8))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, Math.max(0, limit - always.length));

  return [...always, ...rest].map((s) => ({ ...toLearningItemDto(s.item), relevance: Math.round(s.relevance * 1000) / 1000 }));
}

export async function listLearningContext(ownerId: string, projectId: string): Promise<LearningItemDto[]> {
  const items = await LearningContext.find({ ...scopeFilter(toObjectId(ownerId), toObjectId(projectId)), status: 'active' })
    .sort({ salience: -1, lastObservedAt: -1 })
    .limit(100)
    .lean();
  return items.map(toLearningItemDto);
}

/** Learner control: "forget this". */
export async function forgetLearning(ownerId: string, projectId: string, itemId: string) {
  const res = await LearningContext.deleteOne({
    _id: toObjectId(itemId),
    ...scopeFilter(toObjectId(ownerId), toObjectId(projectId)),
  });
  if (res.deletedCount === 0) throw AppError.notFound('Memory item');
}

/** Marks observations as resolved (e.g. a weakness after mastery improves) — they stop being recalled. */
export async function resolveLearning(input: { ownerId: string; projectId: string; itemIds?: string[]; conceptIds?: string[]; kinds?: LearningKind[] }) {
  const filter: Record<string, unknown> = { ownerId: toObjectId(input.ownerId), projectId: toObjectId(input.projectId), status: 'active' };
  if (input.itemIds?.length) filter._id = { $in: input.itemIds.map(toObjectId) };
  if (input.conceptIds?.length) filter.conceptIds = { $in: input.conceptIds.map(toObjectId) };
  if (input.kinds?.length) filter.kind = { $in: input.kinds };
  const res = await LearningContext.updateMany(filter, { $set: { status: 'resolved' } });
  return res.modifiedCount;
}

export async function deleteProjectLearningContext(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  await LearningContext.deleteMany({ ownerId, projectId });
}
