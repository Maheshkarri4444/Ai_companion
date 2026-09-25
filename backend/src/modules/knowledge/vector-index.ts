import { config } from '../../config/env';
import { getDb } from '../../lib/db';
import { logger } from '../../lib/logger';

export const VECTOR_INDEX = 'chunks_vector';

type IndexStatus = 'disabled' | 'unknown' | 'building' | 'ready' | 'unavailable';
const state: { status: IndexStatus; checkedAt: number; detail: string | null } = { status: 'unknown', checkedAt: 0, detail: null };

const definition = () => ({
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: config.AI_EMBEDDING_DIM, similarity: 'cosine' },
    // Pre-filter fields: isolation is enforced inside the vector query itself.
    { type: 'filter', path: 'projectId' },
    { type: 'filter', path: 'ownerId' },
    { type: 'filter', path: 'materialId' },
  ],
});

async function refresh() {
  const collection = getDb().collection('chunks');
  const indexes = (await collection.listSearchIndexes(VECTOR_INDEX).toArray()) as Array<{ status?: string; queryable?: boolean }>;
  const index = indexes[0];
  if (!index) {
    state.status = 'building';
    state.detail = 'creating';
  } else {
    state.status = index.queryable ? 'ready' : index.status === 'FAILED' ? 'unavailable' : 'building';
    state.detail = index.status ?? null;
  }
  state.checkedAt = Date.now();
}

/**
 * Creates the Atlas Vector Search index if missing (idempotent). Outside Atlas (local MongoDB, tests) the
 * command is unsupported and retrieval transparently uses the in-process cosine fallback.
 */
export async function ensureVectorIndex(): Promise<void> {
  if (!config.VECTOR_SEARCH_ENABLED) {
    state.status = 'disabled';
    return;
  }
  try {
    const db = getDb();
    const exists = await db.listCollections({ name: 'chunks' }, { nameOnly: true }).hasNext();
    if (!exists) await db.createCollection('chunks').catch(() => undefined);
    const collection = db.collection('chunks');
    const current = await collection.listSearchIndexes(VECTOR_INDEX).toArray();
    if (current.length === 0) {
      await collection.createSearchIndex({ name: VECTOR_INDEX, type: 'vectorSearch', definition: definition() });
      logger.info('Atlas Vector Search index requested');
    }
    await refresh();
    logger.info({ status: state.status, detail: state.detail }, 'Vector index status');
  } catch (err) {
    state.status = 'unavailable';
    state.detail = (err as Error).message?.slice(0, 200) ?? 'unknown';
    state.checkedAt = Date.now();
    logger.warn({ detail: state.detail }, 'Atlas Vector Search unavailable; using in-process similarity');
  }
}

/** Cached readiness check (re-polls a building index at most once a minute). */
export async function vectorIndexReady(): Promise<boolean> {
  if (state.status === 'ready') return true;
  if (state.status === 'disabled' || state.status === 'unavailable') return false;
  if (Date.now() - state.checkedAt > 60_000) await refresh().catch(() => undefined);
  return vectorIndexState().status === 'ready'; // re-read: refresh() mutates state
}

export function markVectorIndexBroken(detail: string) {
  state.status = 'building';
  state.detail = detail.slice(0, 200);
  state.checkedAt = Date.now();
}

export function vectorIndexState() {
  return { ...state };
}
