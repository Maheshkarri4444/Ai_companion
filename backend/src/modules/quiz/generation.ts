import type { Types } from 'mongoose';
import { z } from 'zod';
import { ai, AIError, type CallMeta } from '../../ai';
import { QUIZ_GENERATE_PROMPT } from '../../ai/prompts/quiz';
import { escapePromptData, truncate } from '../../lib/text';
import { Chunk } from '../../models/knowledge.model';
import { Material } from '../../models/material.model';
import { COGNITIVE_LEVELS, OPTION_IDS, type CognitiveLevel, type QuestionType } from '../../models/quiz.model';
import { retrieve } from '../knowledge/retrieval';
import { ISSUE_HINTS, shuffleOptions, validateGeneratedQuestion, type GeneratedQuestion, type ValidationResult } from './validation';

/*
 * Question generation (docs/ARCHITECTURE.md §16): the concept's own passages → structured output → rule
 * validation → one regeneration with the rejection reasons → shuffled options. The caller picks another
 * concept when a question still fails, so an invalid item never reaches the learner.
 */

/** A passage a question is written from (and later cited under the answer). */
export interface EvidencePassage {
  ref: string;
  chunkId: string | null;
  materialId: string;
  materialTitle: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
}

const MAX_PASSAGES = 3;
const PASSAGE_CHARS = 2400;

/**
 * The concept's own chunks (linked by the knowledge pipeline), preferring passages not used by earlier questions
 * on it and pages the concept was extracted from; falls back to hybrid retrieval. Passages flagged as
 * instruction-like are never used to write questions.
 */
export async function loadConceptEvidence(input: {
  ownerId: Types.ObjectId;
  projectId: Types.ObjectId;
  concept: { _id: Types.ObjectId; name: string; description: string; sources: Array<{ materialId: Types.ObjectId; pages: number[] }> };
  usedChunkIds: string[];
  rng: () => number;
  meta?: CallMeta;
  signal?: AbortSignal;
}): Promise<EvidencePassage[]> {
  const { ownerId, projectId, concept } = input;
  const readyMaterials = await Material.find({ ownerId, projectId, status: 'ready' }, { title: 1 }).lean();
  const titleOf = new Map(readyMaterials.map((m) => [m._id.toString(), m.title]));
  const conceptPages = new Set(concept.sources.flatMap((s) => s.pages.map((p) => `${s.materialId.toString()}:${p}`)));
  const used = new Set(input.usedChunkIds);

  const linked = await Chunk.find(
    { ownerId, projectId, conceptIds: concept._id, 'flags.suspectedInjection': { $ne: true } },
    { text: 1, materialId: 1, pageStart: 1, pageEnd: 1, sectionTitle: 1, index: 1 },
  )
    .limit(60)
    .lean();
  let passages = linked
    .filter((c) => titleOf.has(c.materialId.toString()))
    .map((c) => ({
      chunkId: c._id.toString(),
      materialId: c.materialId.toString(),
      materialTitle: titleOf.get(c.materialId.toString())!,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      sectionTitle: c.sectionTitle,
      text: c.text,
      rank: (used.has(c._id.toString()) ? 2 : 0) + (conceptPages.has(`${c.materialId.toString()}:${c.pageStart}`) ? 0 : 1) + input.rng() * 0.9,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_PASSAGES);

  if (passages.length === 0) {
    const result = await retrieve({
      ownerId: ownerId.toString(),
      projectId: projectId.toString(),
      query: `${concept.name}: ${concept.description}`.slice(0, 400),
      limit: 4,
      meta: input.meta,
      signal: input.signal,
    }).catch((err) => {
      if (err instanceof AIError && err.kind === 'aborted') throw err;
      return null;
    });
    passages =
      result && result.sufficiency !== 'none'
        ? result.sources
            .filter((s) => !s.suspectedInjection && titleOf.has(s.materialId))
            .slice(0, MAX_PASSAGES)
            .map((s) => ({
              chunkId: s.chunkId,
              materialId: s.materialId,
              materialTitle: s.materialTitle,
              pageStart: s.pageStart,
              pageEnd: s.pageEnd,
              sectionTitle: s.sectionTitle,
              text: s.text,
              rank: 0,
            }))
        : [];
  }
  return passages.map(({ rank: _rank, ...p }, i) => ({ ...p, ref: `S${i + 1}` }));
}

const escapeAttr = (value: string) => escapePromptData(value).replace(/"/g, "'").slice(0, 160);
const pagesAttr = (p: { pageStart: number; pageEnd: number }) =>
  p.pageStart === p.pageEnd ? `page="${p.pageStart}"` : `pages="${p.pageStart}-${p.pageEnd}"`;

/** `<sources>` block: material text is escaped so it cannot forge prompt delimiters. */
export function sourcesBlock(passages: EvidencePassage[], limit = PASSAGE_CHARS): string {
  const blocks = passages.map(
    (p) =>
      `<source id="${p.ref}" material="${escapeAttr(p.materialTitle)}" ${pagesAttr(p)}${p.sectionTitle ? ` section="${escapeAttr(p.sectionTitle)}"` : ''}>\n${escapePromptData(truncate(p.text, limit))}\n</source>`,
  );
  return `<sources>\n${blocks.join('\n')}\n</sources>`;
}

// The model-facing schema carries structure and enums; lengths and counts are checked by the rules afterwards.
const McqOutput = z.object({
  stem: z.string(),
  options: z.array(z.object({ id: z.enum(OPTION_IDS), text: z.string(), rationale: z.string() })),
  correctOptionId: z.enum(OPTION_IDS),
  explanation: z.string(),
  sourceIds: z.array(z.string()),
  difficulty: z.number().int().min(1).max(5),
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
});

const OpenOutput = z.object({
  stem: z.string(),
  keyPoints: z.array(z.string()),
  sampleAnswer: z.string(),
  explanation: z.string(),
  sourceIds: z.array(z.string()),
  difficulty: z.number().int().min(1).max(5),
  cognitiveLevel: z.enum(COGNITIVE_LEVELS),
});

export interface GenerationRequest {
  concept: { name: string; description: string };
  type: QuestionType;
  difficulty: number;
  cognitiveLevel: CognitiveLevel;
  goal: string;
  learnerContext: string;
  avoidStems: string[];
  evidence: EvidencePassage[];
  usedStemHashes: Set<string>;
  rng: () => number;
  meta?: CallMeta;
  signal?: AbortSignal;
}

export interface GenerationResult {
  /** Validated (and shuffled) question, or null when both attempts failed the rules. */
  question: GeneratedQuestion | null;
  validation: ValidationResult;
  attempts: number;
  aiCallIds: string[];
  model: string | null;
  latencyMs: number;
  costUsd: number;
  selfRated: { difficulty: number | null; cognitiveLevel: string | null };
}

export async function generateQuestion(request: GenerationRequest): Promise<GenerationResult> {
  const started = Date.now();
  const refs = new Set(request.evidence.map((e) => e.ref));
  const sources = sourcesBlock(request.evidence);
  const result: GenerationResult = {
    question: null,
    validation: { passed: false, issues: [], warnings: [] },
    attempts: 0,
    aiCallIds: [],
    model: null,
    latencyMs: 0,
    costUsd: 0,
    selfRated: { difficulty: null, cognitiveLevel: null },
  };
  let feedback: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    result.attempts = attempt;
    const text = QUIZ_GENERATE_PROMPT.build({
      goal: truncate(request.goal, 300),
      concept: { name: request.concept.name, description: truncate(request.concept.description, 400) },
      type: request.type,
      difficulty: request.difficulty,
      cognitiveLevel: request.cognitiveLevel,
      learnerContext: request.learnerContext,
      avoid: request.avoidStems.map((s) => escapePromptData(truncate(s, 200))),
      sources,
      feedback,
    });
    const common = {
      feature: 'quiz.generate' as const,
      tier: 'primary' as const,
      reasoning: 'low' as const,
      promptVersion: QUIZ_GENERATE_PROMPT.version,
      system: QUIZ_GENERATE_PROMPT.system,
      contents: [{ role: 'user' as const, parts: [{ text }] }],
      meta: request.meta,
      signal: request.signal,
      timeoutMs: 45_000,
      inputPreview: `${request.type.toUpperCase()} d${request.difficulty} ${request.cognitiveLevel} · ${request.concept.name}`,
      metadata: { concept: request.concept.name, type: request.type, difficulty: request.difficulty, level: request.cognitiveLevel, attempt },
    };
    let question: GeneratedQuestion;
    if (request.type === 'mcq') {
      const out = await ai().structured({ ...common, schema: McqOutput });
      question = { type: 'mcq', ...out.data };
      track(result, out);
    } else {
      const out = await ai().structured({ ...common, schema: OpenOutput });
      question = { type: 'open', ...out.data, keyPoints: [...new Set(out.data.keyPoints.map((k) => k.trim()).filter((k) => k.length >= 3))].slice(0, 6) };
      track(result, out);
    }
    result.selfRated = { difficulty: question.difficulty, cognitiveLevel: question.cognitiveLevel };

    const validation = validateGeneratedQuestion(question, {
      sourceRefs: refs,
      usedStemHashes: request.usedStemHashes,
      requested: { difficulty: request.difficulty, cognitiveLevel: request.cognitiveLevel },
    });
    result.validation = {
      passed: validation.passed,
      issues: validation.issues,
      warnings: [...new Set([...(attempt > 1 ? ['regenerated'] : []), ...validation.warnings])],
    };
    if (validation.passed) {
      result.question = finalize(question, refs, request.rng);
      break;
    }
    feedback = validation.issues.map((issue) => ISSUE_HINTS[issue] ?? issue);
  }
  result.latencyMs = Date.now() - started;
  return result;
}

function track(result: GenerationResult, out: { aiCallId: string; model: string; costUsd: number }) {
  result.aiCallIds.push(out.aiCallId);
  result.model = out.model;
  result.costUsd += out.costUsd;
}

/** Trims text, keeps only valid source ids and shuffles MCQ options (answer position carries no signal). */
function finalize(question: GeneratedQuestion, refs: Set<string>, rng: () => number): GeneratedQuestion {
  const sourceIds = [...new Set(question.sourceIds.map((s) => s.trim()).filter((s) => refs.has(s)))];
  const base = { stem: question.stem.trim(), explanation: question.explanation.trim(), sourceIds };
  if (question.type === 'open') {
    return { ...question, ...base, keyPoints: question.keyPoints.slice(0, 5), sampleAnswer: question.sampleAnswer.trim() };
  }
  const { options, correctOptionId } = shuffleOptions(question.options, question.correctOptionId, rng);
  return { ...question, ...base, options, correctOptionId };
}
