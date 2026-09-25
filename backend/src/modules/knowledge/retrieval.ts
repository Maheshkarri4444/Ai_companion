import { Types } from 'mongoose';
import { ai, type CallMeta } from '../../ai';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { dot } from '../../lib/vector';
import { Chunk } from '../../models/knowledge.model';
import { Material } from '../../models/material.model';
import { markVectorIndexBroken, VECTOR_INDEX, vectorIndexReady } from './vector-index';

export type Sufficiency = 'strong' | 'weak' | 'none';

export interface RetrievedSource {
  chunkId: string;
  materialId: string;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  conceptIds: string[];
  suspectedInjection: boolean;
  /** Cosine similarity to the query (0 when found only lexically). */
  score: number;
  lexicalRank: number | null;
  fused: number;
}

export interface RetrievalResult {
  sources: RetrievedSource[];
  sufficiency: Sufficiency;
  topScore: number;
  method: 'atlas' | 'memory';
  trace: Record<string, unknown>;
}

const CANDIDATES = 24;
const RRF_K = 60;
const LEXICAL_WEIGHT = 0.8;
const MEMORY_FALLBACK_CAP = 5000;
const round = (n: number) => Math.round(n * 1000) / 1000;

async function vectorSearch(owner: Types.ObjectId, project: Types.ObjectId, vector: number[]) {
  if (await vectorIndexReady()) {
    try {
      const rows = await Chunk.aggregate<{ _id: Types.ObjectId; score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: 'embedding',
            queryVector: vector,
            numCandidates: 150,
            limit: CANDIDATES,
            filter: { projectId: project, ownerId: owner },
          },
        },
        { $project: { _id: 1, score: { $meta: 'vectorSearchScore' } } },
      ]);
      // Atlas reports cosine as (1 + cos) / 2; convert back so thresholds are comparable with the fallback.
      if (rows.length) return { method: 'atlas' as const, hits: rows.map((r) => ({ id: r._id.toString(), score: 2 * r.score - 1 })) };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Vector search failed; falling back to in-process similarity');
      markVectorIndexBroken((err as Error).message);
    }
  }
  const rows = await Chunk.find({ ownerId: owner, projectId: project }).select('+embedding').limit(MEMORY_FALLBACK_CAP).lean();
  const hits = rows
    .filter((r) => r.embedding?.length)
    .map((r) => ({ id: r._id.toString(), score: dot(r.embedding, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES);
  return { method: 'memory' as const, hits };
}

async function lexicalSearch(owner: Types.ObjectId, project: Types.ObjectId, query: string) {
  try {
    const rows = await Chunk.find(
      { projectId: project, ownerId: owner, $text: { $search: query } },
      { score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(CANDIDATES)
      .lean<Array<{ _id: Types.ObjectId; score: number }>>();
    return rows.map((r) => ({ id: r._id.toString(), score: r.score }));
  } catch {
    return [];
  }
}

/**
 * Hybrid retrieval scoped to one Project: dense (vector) + lexical ($text) candidates fused with Reciprocal
 * Rank Fusion, then an evidence-sufficiency verdict the Tutor uses to decide whether it may answer
 * (docs/ARCHITECTURE.md §13).
 */
export async function retrieve(input: {
  ownerId: string;
  projectId: string;
  query: string;
  limit?: number;
  excludeChunkIds?: string[];
  meta?: CallMeta;
  signal?: AbortSignal;
}): Promise<RetrievalResult> {
  const started = Date.now();
  const owner = new Types.ObjectId(input.ownerId);
  const project = new Types.ObjectId(input.projectId);
  const limit = input.limit ?? 6;
  const exclude = new Set(input.excludeChunkIds ?? []);

  const [queryVector] = await ai().embed([input.query], {
    feature: 'embed.query',
    taskType: 'RETRIEVAL_QUERY',
    meta: input.meta,
    signal: input.signal,
  });
  const embeddedAt = Date.now();
  const [vector, lexical] = await Promise.all([vectorSearch(owner, project, queryVector), lexicalSearch(owner, project, input.query)]);
  const searchedAt = Date.now();

  const fused = new Map<string, { rrf: number; score: number; lexicalRank: number | null }>();
  vector.hits.forEach((hit, i) => {
    const entry = fused.get(hit.id) ?? { rrf: 0, score: 0, lexicalRank: null };
    entry.rrf += 1 / (RRF_K + i + 1);
    entry.score = hit.score;
    fused.set(hit.id, entry);
  });
  lexical.forEach((hit, i) => {
    const entry = fused.get(hit.id) ?? { rrf: 0, score: 0, lexicalRank: null };
    entry.rrf += LEXICAL_WEIGHT / (RRF_K + i + 1);
    entry.lexicalRank = i + 1;
    fused.set(hit.id, entry);
  });

  const minKeep = config.RETRIEVAL_MIN_SCORE - 0.12;
  const ranked = [...fused.entries()]
    .filter(([id, e]) => !exclude.has(id) && (e.score >= minKeep || (e.lexicalRank !== null && e.lexicalRank <= 5)))
    .sort((a, b) => b[1].rrf - a[1].rrf)
    .slice(0, limit);

  const topScore = vector.hits.find((h) => !exclude.has(h.id))?.score ?? 0;
  const lexicalSupport = ranked.filter(([, e]) => e.lexicalRank !== null && e.lexicalRank <= 3).length;
  let sufficiency: Sufficiency = 'none';
  if (topScore >= config.RETRIEVAL_STRONG_SCORE) sufficiency = 'strong';
  else if (topScore >= config.RETRIEVAL_MIN_SCORE) sufficiency = 'weak';
  else if (lexicalSupport >= 2 && topScore >= config.RETRIEVAL_MIN_SCORE - 0.08) sufficiency = 'weak';
  if (ranked.length === 0) sufficiency = 'none';

  const ids = ranked.map(([id]) => new Types.ObjectId(id));
  const docs = await Chunk.find({ _id: { $in: ids }, ownerId: owner, projectId: project }).lean();
  const materials = await Material.find({ _id: { $in: [...new Set(docs.map((d) => d.materialId.toString()))] } }, { title: 1 }).lean();
  const titleOf = new Map(materials.map((m) => [m._id.toString(), m.title]));
  const docById = new Map(docs.map((d) => [d._id.toString(), d]));

  const sources: RetrievedSource[] = ranked.flatMap(([id, e]) => {
    const doc = docById.get(id);
    if (!doc) return [];
    return [
      {
        chunkId: id,
        materialId: doc.materialId.toString(),
        materialTitle: titleOf.get(doc.materialId.toString()) ?? 'Material',
        pageStart: doc.pageStart,
        pageEnd: doc.pageEnd,
        sectionTitle: doc.sectionTitle,
        text: doc.text,
        conceptIds: (doc.conceptIds ?? []).map((c) => c.toString()),
        suspectedInjection: Boolean(doc.flags?.suspectedInjection),
        score: round(e.score),
        lexicalRank: e.lexicalRank,
        fused: round(e.rrf * 100),
      },
    ];
  });

  return {
    sources,
    sufficiency,
    topScore: round(topScore),
    method: vector.method,
    trace: {
      query: input.query,
      method: vector.method,
      thresholds: { strong: config.RETRIEVAL_STRONG_SCORE, min: config.RETRIEVAL_MIN_SCORE },
      sufficiency,
      topScore: round(topScore),
      timingsMs: { embed: embeddedAt - started, search: searchedAt - embeddedAt, total: Date.now() - started },
      vectorCandidates: vector.hits.slice(0, 10).map((h) => ({ chunkId: h.id, score: round(h.score) })),
      lexicalCandidates: lexical.slice(0, 10).map((h) => ({ chunkId: h.id, score: round(h.score) })),
      selected: sources.map((s) => ({
        chunkId: s.chunkId,
        material: s.materialTitle,
        pages: s.pageStart === s.pageEnd ? `${s.pageStart}` : `${s.pageStart}-${s.pageEnd}`,
        score: s.score,
        lexicalRank: s.lexicalRank,
        fused: s.fused,
      })),
    },
  };
}
