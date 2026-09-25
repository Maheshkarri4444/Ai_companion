import { Types } from 'mongoose';
import { z } from 'zod';
import { ai, type CallMeta } from '../../ai';
import { CONCEPTS_PROMPT } from '../../ai/prompts/knowledge';
import { isDuplicateKeyError } from '../../lib/errors';
import { escapePromptData, slugify } from '../../lib/text';
import { dot } from '../../lib/vector';
import { Chunk, Concept, type IConcept } from '../../models/knowledge.model';

const Extraction = z.object({
  summary: z.string().max(2000),
  concepts: z
    .array(
      z.object({
        name: z.string().min(2).max(120),
        description: z.string().max(800),
        importance: z.number().int().min(1).max(5),
        pages: z.array(z.number().int()).max(80),
      }),
    )
    .max(40),
});

export interface ExtractedConcept {
  name: string;
  slug: string;
  description: string;
  importance: number; // 1–5
  pages: number[];
}

const GROUP_CHARS = 60_000;
const PAGE_CHARS = 4_000;
const MAX_GROUPS = 6;
const MERGE_SIMILARITY = 0.9;
/** Minimum concept→chunk similarity to link them (concept embedded as a query, chunk as a document). */
export const LINK_MIN_SCORE = 0.45;

/** Map-reduce over page groups so long documents stay within budget; concepts are merged by slug. */
export async function extractConcepts(input: {
  title: string;
  goal: string;
  pageCount: number;
  pages: Array<{ pageNumber: number; text: string }>;
  meta: CallMeta;
  signal?: AbortSignal;
}): Promise<{ summary: string; concepts: ExtractedConcept[] }> {
  const blocks = input.pages
    .filter((p) => p.text.trim())
    .map((p) => `--- Page ${p.pageNumber} ---\n${p.text.slice(0, PAGE_CHARS)}`);
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const block of blocks) {
    if (size + block.length > GROUP_CHARS && current.length) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.length;
  }
  if (current.length) groups.push(current);
  const selected = groups.slice(0, MAX_GROUPS);

  const summaries: string[] = [];
  const bySlug = new Map<string, ExtractedConcept>();
  for (const [i, group] of selected.entries()) {
    const { data } = await ai().structured({
      feature: 'material.concepts',
      tier: 'light',
      promptVersion: CONCEPTS_PROMPT.version,
      system: CONCEPTS_PROMPT.system,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: CONCEPTS_PROMPT.build({
                title: input.title,
                goal: input.goal,
                pageCount: input.pageCount,
                material: escapePromptData(group.join('\n\n')),
                partial: selected.length > 1,
              }),
            },
          ],
        },
      ],
      schema: Extraction,
      meta: input.meta,
      signal: input.signal,
      timeoutMs: 120_000,
      inputPreview: `Concepts for "${input.title}" (part ${i + 1}/${selected.length})`,
    });
    if (data.summary.trim()) summaries.push(data.summary.trim());
    for (const concept of data.concepts) {
      const slug = slugify(concept.name);
      if (!slug) continue;
      const pages = [...new Set(concept.pages.filter((p) => p >= 1 && p <= input.pageCount))].sort((a, b) => a - b);
      const existing = bySlug.get(slug);
      if (existing) {
        existing.importance = Math.max(existing.importance, concept.importance);
        existing.pages = [...new Set([...existing.pages, ...pages])].sort((a, b) => a - b);
      } else {
        bySlug.set(slug, { name: concept.name.trim(), slug, description: concept.description.trim(), importance: concept.importance, pages });
      }
    }
  }
  return {
    summary: summaries[0] ?? '',
    concepts: [...bySlug.values()].sort((a, b) => b.importance - a.importance).slice(0, 25),
  };
}

/** Adds a material's concepts to the Project, merging near-duplicates ("Backprop" ≈ "Backpropagation"). */
export async function mergeProjectConcepts(input: {
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  materialId: Types.ObjectId;
  concepts: ExtractedConcept[];
  meta: CallMeta;
  signal?: AbortSignal;
}) {
  if (input.concepts.length === 0) return;
  const vectors = await ai().embed(
    input.concepts.map((c) => `${c.name}: ${c.description}`),
    { feature: 'embed.document', taskType: 'RETRIEVAL_QUERY', meta: input.meta, signal: input.signal },
  );
  const existing: Array<Pick<IConcept, '_id' | 'slug' | 'embedding'>> = await Concept.find({ ownerId: input.ownerId, projectId: input.projectId })
    .select('+embedding slug')
    .lean();

  for (const [i, concept] of input.concepts.entries()) {
    const vector = vectors[i];
    const match =
      existing.find((e) => e.slug === concept.slug) ??
      existing
        .map((e) => ({ e, score: e.embedding?.length ? dot(e.embedding, vector) : 0 }))
        .filter((x) => x.score >= MERGE_SIMILARITY)
        .sort((a, b) => b.score - a.score)[0]?.e;
    if (match) {
      await Concept.updateOne({ _id: match._id }, { $pull: { sources: { materialId: input.materialId } } });
      await Concept.updateOne(
        { _id: match._id },
        { $push: { sources: { materialId: input.materialId, pages: concept.pages } }, $max: { importance: concept.importance / 5 } },
      );
      continue;
    }
    try {
      const created = await Concept.create({
        ownerId: input.ownerId,
        projectId: input.projectId,
        name: concept.name,
        slug: concept.slug,
        description: concept.description,
        importance: concept.importance / 5,
        sources: [{ materialId: input.materialId, pages: concept.pages }],
        embedding: vector,
      });
      existing.push({ _id: created._id, slug: created.slug, embedding: vector });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err; // concurrent processing created it first
    }
  }
}

/** Links every chunk of the Project to its most related concepts (no LLM calls: embedding similarity). */
export async function linkChunksToConcepts(ownerId: Types.ObjectId, projectId: Types.ObjectId) {
  const concepts = await Concept.find({ ownerId, projectId }).select('+embedding').lean();
  const chunks = await Chunk.find({ ownerId, projectId }).select('+embedding conceptIds').lean();
  const usable = concepts.filter((c) => c.embedding?.length);
  const ops = chunks
    .filter((chunk) => chunk.embedding?.length)
    .map((chunk) => {
      const ranked = usable
        .map((c) => ({ id: c._id, score: dot(chunk.embedding, c.embedding) }))
        .sort((a, b) => b.score - a.score);
      const picked: Types.ObjectId[] = [];
      if (ranked[0] && ranked[0].score >= LINK_MIN_SCORE) picked.push(ranked[0].id);
      if (ranked[1] && ranked[1].score >= LINK_MIN_SCORE && ranked[0].score - ranked[1].score <= 0.06) picked.push(ranked[1].id);
      return { updateOne: { filter: { _id: chunk._id }, update: { $set: { conceptIds: picked } } } };
    });
  if (ops.length) await Chunk.bulkWrite(ops, { ordered: false });

  const counts = await Chunk.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { ownerId, projectId } },
    { $unwind: '$conceptIds' },
    { $group: { _id: '$conceptIds', n: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [c._id.toString(), c.n]));
  if (concepts.length) {
    await Concept.bulkWrite(
      concepts.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { chunkCount: byId.get(c._id.toString()) ?? 0 } } } })),
      { ordered: false },
    );
  }
}

/** Removes a deleted material from concept sources; concepts left without sources are deleted. */
export async function detachMaterialFromConcepts(ownerId: Types.ObjectId, projectId: Types.ObjectId, materialId: Types.ObjectId) {
  await Concept.updateMany({ ownerId, projectId }, { $pull: { sources: { materialId } } });
  const orphans = await Concept.find({ ownerId, projectId, sources: { $size: 0 } }, { _id: 1 }).lean();
  if (orphans.length) {
    const ids = orphans.map((o) => o._id);
    await Concept.deleteMany({ _id: { $in: ids } });
    await Chunk.updateMany({ ownerId, projectId }, { $pull: { conceptIds: { $in: ids } } });
  }
  return orphans.length;
}

export const toConceptId = (id: string) => new Types.ObjectId(id);
