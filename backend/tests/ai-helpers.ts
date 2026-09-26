import type { EventEmitter } from 'node:events';
import { Types } from 'mongoose';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { setAIProvider } from '../src/ai';
import { hashEmbedding, MockAIProvider } from '../src/ai/mock';
import type { AIFunctionCall, ProviderRequest } from '../src/ai/types';
import { Chunk, Concept, MaterialPage } from '../src/models/knowledge.model';
import { Material } from '../src/models/material.model';
import { Project } from '../src/models/project.model';

type Reply = string | { text?: string; functionCalls?: AIFunctionCall[] };

export interface TutorScriptInput {
  request: ProviderRequest;
  /** Text of the final user turn (sources, request, instructions). */
  prompt: string;
  /** Number of tool rounds already completed in this turn. */
  toolRounds: number;
  /** Function responses returned to the model in the latest round. */
  toolResults: Array<Record<string, unknown>>;
}

export interface MockScripts {
  tutor?: (input: TutorScriptInput) => Reply;
  understand?: (prompt: string) => Record<string, unknown>;
  memory?: (prompt: string) => Record<string, unknown>;
  summary?: (prompt: string) => Record<string, unknown>;
  judge?: (prompt: string) => Record<string, unknown>;
  concepts?: (prompt: string) => Record<string, unknown>;
  ocr?: (prompt: string) => Record<string, unknown>;
  /** Quiz generation; `request` parsed from the prompt. Return undefined to use the default valid question. */
  quizQuestion?: (prompt: string, request: QuizRequest) => Record<string, unknown> | undefined;
  quizGrade?: (prompt: string, answer: string) => Record<string, unknown> | undefined;
  quizJudge?: (prompt: string) => Record<string, unknown>;
  mistakePattern?: (prompt: string) => Record<string, unknown>;
}

export interface QuizRequest {
  type: 'mcq' | 'open';
  concept: string;
  difficulty: number;
  level: string;
}

let questionCounter = 0;

/** A valid question for whatever the generator was asked (type, concept, difficulty, level). */
export function defaultQuizQuestion(request: QuizRequest): Record<string, unknown> {
  questionCounter += 1;
  const common = {
    explanation: `The materials explain how ${request.concept} works, which supports the correct answer [S1].`,
    sourceIds: ['S1'],
    difficulty: request.difficulty,
    cognitiveLevel: request.level,
  };
  if (request.type === 'open') {
    return {
      ...common,
      stem: `Question ${questionCounter}: explain in your own words how ${request.concept} works and why it matters.`,
      keyPoints: [`${request.concept} follows the rule described in the notes`, `It matters because it reduces the loss`],
      sampleAnswer: `${request.concept} follows the rule described in the notes, and it matters because it reduces the loss during training.`,
    };
  }
  return {
    ...common,
    stem: `Question ${questionCounter}: which statement about ${request.concept} is correct?`,
    options: [
      { id: 'A', text: `${request.concept} follows the rule described in the notes`, rationale: 'Correct: this is what the notes state.' },
      // Distractors of comparable length: a correct option that is much longer than the rest is flagged
      // (correct_option_longest), so an unrealistic fixture would make results depend on the concept's name length.
      { id: 'B', text: 'It makes the training loss grow on purpose after every single update step', rationale: 'Wrong: training minimises the loss.' },
      { id: 'C', text: 'It only applies to the held-out test data and never during the training phase', rationale: 'Wrong: it is used during training.' },
      { id: 'D', text: 'It removes the need for choosing any learning rate when training a network', rationale: 'Wrong: the learning rate still scales updates.' },
    ],
    correctOptionId: 'A',
  };
}

export function parseQuizRequest(prompt: string): QuizRequest {
  return {
    type: /Question type: open-ended/.test(prompt) ? 'open' : 'mcq',
    concept: prompt.match(/Concept to assess: ([^\n—]+?)(?: —|\n)/)?.[1]?.trim() ?? 'the concept',
    difficulty: Number(prompt.match(/Difficulty: (\d)\/5/)?.[1] ?? 3),
    level: prompt.match(/Cognitive level: (\w+)/)?.[1] ?? 'understand',
  };
}

/** Default grading: an answer mentioning "wrong" misses everything; anything else covers every key point. */
export function defaultQuizGrade(prompt: string, answer: string): Record<string, unknown> {
  const count = (prompt.match(/^K\d+\./gm) ?? []).length;
  const wrong = /wrong/i.test(answer);
  const quote = answer.split(/\s+/).slice(0, 4).join(' ');
  return {
    keyPoints: Array.from({ length: count }, (_, i) => ({ id: `K${i + 1}`, status: wrong ? 'missing' : 'covered', evidence: wrong ? '' : quote })),
    accuracy: wrong ? 1 : 5,
    relevance: wrong ? 3 : 5,
    reasoning: wrong ? 1 : 4,
    misconceptions: wrong ? ['Believes the opposite of what the notes say'] : [],
    understood: wrong ? [] : ['You explained the rule clearly.'],
    missing: wrong ? ['You need to explain how the rule reduces the loss.'] : [],
    feedback: wrong ? 'This answer contradicts the notes. Review how the rule reduces the loss.' : 'Clear and complete answer that covers the key points.',
    overallScore: wrong ? 0.05 : 0.95,
  };
}

const textOf = (request: ProviderRequest) =>
  request.contents
    .flatMap((c) => c.parts)
    .map((p) => p.text ?? '')
    .join('\n');

export const DEFAULT_ANSWER = '[[GROUNDED]]\nBackpropagation computes gradients with the chain rule [S1].\n[[FOLLOWUPS: What is the chain rule? | How is the learning rate chosen? | What is a loss function?]]';

/**
 * Routes each mock generate/stream call by its system prompt, so one provider can play every AI feature
 * (tutor, intent, memory, summary, judge, concepts, OCR) with per-test scripts.
 */
export function installMockAI(scripts: MockScripts = {}) {
  const provider = new MockAIProvider({
    generate: (_model, request) => {
      const system = request.system ?? '';
      const prompt = textOf(request);
      if (system.includes('You are Zoya')) {
        const responses = request.contents.flatMap((c) => c.parts).filter((p) => p.functionResponse);
        const toolRounds = request.contents.filter((c) => c.parts.some((p) => p.functionResponse)).length;
        const lastUser = [...request.contents].reverse().find((c) => c.role === 'user' && c.parts.some((p) => p.text));
        return (
          scripts.tutor?.({
            request,
            prompt: lastUser?.parts.map((p) => p.text ?? '').join('\n') ?? '',
            toolRounds,
            toolResults: responses.map((p) => p.functionResponse!.response),
          }) ?? DEFAULT_ANSWER
        );
      }
      if (system.includes('analyse the latest message')) {
        return JSON.stringify(scripts.understand?.(prompt) ?? { intent: 'follow_up', standaloneQuery: 'backpropagation gradients', needsMaterials: true });
      }
      if (system.includes('running summary')) {
        return JSON.stringify(scripts.summary?.(prompt) ?? { summary: 'The learner is studying backpropagation.', title: 'Backpropagation Basics' });
      }
      if (system.includes('long-term memory')) return JSON.stringify(scripts.memory?.(prompt) ?? { items: [] });
      if (system.includes('strict evaluator')) {
        return JSON.stringify(
          scripts.judge?.(prompt) ?? {
            groundedness: 5,
            citationAccuracy: 4,
            relevance: 5,
            pedagogy: 4,
            insufficientHandling: 'n/a',
            unsupportedClaims: [],
            verdict: 'pass',
            rationale: 'All claims are supported by S1.',
          },
        );
      }
      if (system.includes('key concepts')) {
        return JSON.stringify(
          scripts.concepts?.(prompt) ?? {
            summary: 'Notes on how neural networks learn.',
            concepts: [
              { name: 'Backpropagation', description: 'Computing gradients layer by layer.', importance: 5, pages: [1] },
              { name: 'Gradient Descent', description: 'Moving weights against the gradient.', importance: 4, pages: [2] },
            ],
          },
        );
      }
      if (system.includes('transcribe')) return JSON.stringify(scripts.ocr?.(prompt) ?? { pages: [] });
      if (system.includes('You write assessment questions')) {
        const request = parseQuizRequest(prompt);
        return JSON.stringify(scripts.quizQuestion?.(prompt, request) ?? defaultQuizQuestion(request));
      }
      if (system.includes('fair, precise examiner')) {
        const answer = prompt.match(/<answer[^>]*>\n([\s\S]*?)\n<\/answer>/)?.[1] ?? '';
        return JSON.stringify(scripts.quizGrade?.(prompt, answer) ?? defaultQuizGrade(prompt, answer));
      }
      if (system.includes('strict reviewer of assessment items')) {
        return JSON.stringify(
          scripts.quizJudge?.(prompt) ?? {
            answerable: 5,
            keyCorrect: 5,
            distractors: 4,
            clarity: 5,
            difficultyMatch: 4,
            levelMatch: 4,
            issues: [],
            verdict: 'pass',
            rationale: 'Answerable from S1 with a correct key.',
          },
        );
      }
      if (system.includes("repeated mistakes")) {
        return JSON.stringify(scripts.mistakePattern?.(prompt) ?? { pattern: 'Confuses the direction of the weight update with the gradient direction', salience: 0.8 });
      }
      return 'Mock response.';
    },
  });
  setAIProvider(provider);
  return provider;
}

export const streamCalls = (provider: MockAIProvider) => provider.calls.filter((c) => c.kind === 'stream');

/** Parses a Server-Sent Events body into typed events. */
export function parseSse(body: string): Array<{ type: string; [key: string]: unknown }> {
  return body
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

/** Superagent does not buffer text/event-stream; collect it as a string. */
export function textParser(res: EventEmitter, cb: (err: Error | null, body: string) => void) {
  let data = '';
  res.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
  res.on('end', () => cb(null, data));
  res.on('error', (err: Error) => cb(err, ''));
}

export const ML_PAGES = [
  'Backpropagation computes gradients of the loss with respect to each weight using the chain rule, moving backwards through the network layers.',
  'Gradient descent updates each weight by subtracting the learning rate multiplied by the gradient. A small learning rate converges slowly; a large one can overshoot.',
  'Overfitting happens when a network memorises training data. Regularisation such as dropout and weight decay reduces overfitting and improves generalisation.',
];

/**
 * Inserts a ready material with pages, chunks (mock embeddings) and concepts directly — the fast path for
 * Tutor tests. The full pipeline is exercised separately in knowledge.test.ts.
 */
export async function seedKnowledge(projectId: string, options: { title?: string; pages?: string[]; injectPage?: number } = {}) {
  const project = await Project.findById(projectId).lean();
  if (!project) throw new Error('project not found');
  const pages = options.pages ?? ML_PAGES;
  const material = await Material.create({
    ownerId: project.ownerId,
    spaceId: project.spaceId,
    projectId: project._id,
    title: options.title ?? 'Machine Learning Notes',
    originalFilename: 'ml-notes.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    sha256: new Types.ObjectId().toString(),
    storage: { provider: 'gridfs', fileId: new Types.ObjectId() },
    status: 'ready',
    pageCount: pages.length,
    stats: { chunkCount: pages.length, conceptCount: 2, ocrPageCount: 0 },
  });
  const scope = { ownerId: project.ownerId, projectId: project._id, materialId: material._id };
  await MaterialPage.insertMany(pages.map((text, i) => ({ ...scope, pageNumber: i + 1, text, charCount: text.length, sectionTitle: null })));
  await Chunk.insertMany(
    pages.map((text, i) => ({
      ...scope,
      index: i,
      pageStart: i + 1,
      pageEnd: i + 1,
      sectionTitle: null,
      text,
      tokenEstimate: Math.ceil(text.length / 4),
      embedding: hashEmbedding(text),
      flags: { suspectedInjection: options.injectPage === i + 1 },
    })),
  );
  await Concept.insertMany(
    [
      { name: 'Backpropagation', description: 'Computing gradients layer by layer.', pages: [1] },
      { name: 'Gradient Descent', description: 'Weight updates against the gradient.', pages: [2] },
    ].map((c, i) => ({
      ownerId: project.ownerId,
      projectId: project._id,
      name: c.name,
      slug: c.name.toLowerCase().replace(/\s+/g, '-'),
      description: c.description,
      importance: 1 - i * 0.2,
      sources: [{ materialId: material._id, pages: c.pages }],
      embedding: hashEmbedding(`${c.name}: ${c.description}`),
      chunkCount: 1,
    })),
  );
  return material;
}

/** A real multi-page text PDF (pdf-lib + Helvetica) for pipeline tests. */
export async function makeTextPdf(pages: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    const words = text.split(/\s+/);
    let line = '';
    let y = 740;
    for (const word of words) {
      if ((line + ' ' + word).length > 80) {
        page.drawText(line, { x: 50, y, size: 11, font });
        y -= 16;
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) page.drawText(line, { x: 50, y, size: 11, font });
  }
  return Buffer.from(await doc.save());
}
