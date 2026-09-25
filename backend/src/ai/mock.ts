import { createHash } from 'node:crypto';
import { l2normalize } from '../lib/vector';
import type { AIError } from './errors';
import {
  emptyUsage,
  type AIFunctionCall,
  type AIPart,
  type AIProvider,
  type EmbedTask,
  type ProviderRequest,
  type ProviderResult,
  type ProviderStreamChunk,
} from './types';

type MockReply = string | { text?: string; functionCalls?: AIFunctionCall[] };
export type MockGenerateHandler = (model: string, request: ProviderRequest) => MockReply | Promise<MockReply>;

const STOPWORDS = new Set(
  'a an the of to in on for and or is are was were be been it its this that with as by at from what how why when which who does do did can could should would into about your you i me my we our their them they'.split(
    ' ',
  ),
);

/**
 * Deterministic bag-of-words embedding: texts that share words get high cosine similarity, unrelated texts
 * score near zero. Good enough to exercise retrieval logic in tests without a network.
 */
export function hashEmbedding(text: string, dims = 768): number[] {
  const vector = new Array<number>(dims).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  for (const word of words) {
    const h = createHash('md5').update(word).digest();
    vector[h.readUInt32LE(0) % dims] += 1;
  }
  return l2normalize(vector);
}

export interface MockCall {
  kind: 'generate' | 'stream' | 'embed';
  model: string;
  request?: ProviderRequest;
  texts?: string[];
}

/** Scriptable provider for tests: plug in handlers, make specific models fail, inspect every call. */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  readonly calls: MockCall[] = [];
  failures = new Map<string, AIError>();

  constructor(
    public handlers: {
      generate?: MockGenerateHandler;
      embed?: (texts: string[], taskType: EmbedTask) => number[][];
    } = {},
    private readonly dims = 768,
  ) {}

  private async reply(model: string, request: ProviderRequest): Promise<ProviderResult> {
    const failure = this.failures.get(model);
    if (failure) throw failure;
    const raw = (await this.handlers.generate?.(model, request)) ?? (request.jsonSchema ? '{}' : 'Mock response.');
    const reply = typeof raw === 'string' ? { text: raw } : raw;
    const parts: AIPart[] = [];
    if (reply.text) parts.push({ text: reply.text });
    for (const call of reply.functionCalls ?? []) parts.push({ functionCall: call, thoughtSignature: 'mock-signature' });
    const inputChars = JSON.stringify(request.contents).length + (request.system?.length ?? 0);
    return {
      text: reply.text ?? '',
      parts,
      functionCalls: reply.functionCalls ?? [],
      usage: { ...emptyUsage(), inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil((reply.text ?? '').length / 4) },
      finishReason: 'STOP',
      modelVersion: model,
    };
  }

  async generate(model: string, request: ProviderRequest): Promise<ProviderResult> {
    this.calls.push({ kind: 'generate', model, request });
    return this.reply(model, request);
  }

  async *stream(model: string, request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    this.calls.push({ kind: 'stream', model, request });
    const result = await this.reply(model, request);
    for (let i = 0; i < result.text.length; i += 24) yield { type: 'text', text: result.text.slice(i, i + 24) };
    for (const call of result.functionCalls) yield { type: 'function_call', call };
    yield { type: 'done', usage: result.usage, parts: result.parts, finishReason: 'STOP', modelVersion: model };
  }

  async embed(model: string, texts: string[], options: { taskType: EmbedTask }): Promise<number[][]> {
    this.calls.push({ kind: 'embed', model, texts });
    const failure = this.failures.get(model);
    if (failure) throw failure;
    return this.handlers.embed?.(texts, options.taskType) ?? texts.map((t) => hashEmbedding(t, this.dims));
  }
}
