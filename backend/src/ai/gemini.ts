import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from '@google/genai';
import { l2normalize } from '../lib/vector';
import { AIError } from './errors';
import type { AIContent, AIPart, AIProvider, EmbedTask, ProviderRequest, ProviderResult, ProviderStreamChunk, Usage } from './types';

const LEVELS = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

function toUsage(meta?: GenerateContentResponseUsageMetadata): Usage {
  const input = meta?.promptTokenCount ?? 0;
  const output = meta?.candidatesTokenCount ?? 0;
  const thinking = meta?.thoughtsTokenCount ?? 0;
  return { inputTokens: input, outputTokens: output, thinkingTokens: thinking, totalTokens: meta?.totalTokenCount ?? input + output + thinking };
}

function fromPart(part: Part): AIPart {
  const out: AIPart = {};
  if (part.text !== undefined) out.text = part.text;
  if (part.thought) out.thought = true;
  if (part.thoughtSignature) out.thoughtSignature = part.thoughtSignature;
  if (part.functionCall?.name) {
    out.functionCall = { id: part.functionCall.id, name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> };
  }
  return out;
}

function toContents(contents: AIContent[]): Content[] {
  return contents.map((c) => ({ role: c.role, parts: c.parts.map((p) => ({ ...p }) as Part) }));
}

/** Streamed text arrives in pieces; merge them so the echoed model turn stays compact (signatures kept). */
function appendPart(parts: AIPart[], part: AIPart) {
  const last = parts[parts.length - 1];
  const plainText = part.text !== undefined && !part.functionCall && !part.thoughtSignature;
  if (plainText && last && last.text !== undefined && !last.functionCall && Boolean(last.thought) === Boolean(part.thought)) {
    last.text += part.text;
    return;
  }
  parts.push({ ...part });
}

function assertNotBlocked(response: GenerateContentResponse) {
  const blockReason = response.promptFeedback?.blockReason;
  const finish = response.candidates?.[0]?.finishReason;
  if (blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
    throw new AIError('blocked', `Response blocked (${blockReason ?? finish}).`);
  }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    // No SDK-level retries: the gateway owns retry/fallback policy.
    this.client = new GoogleGenAI({ apiKey });
  }

  private config(request: ProviderRequest): GenerateContentConfig {
    return {
      abortSignal: request.signal,
      systemInstruction: request.system,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      ...(request.thinking ? { thinkingConfig: { thinkingLevel: LEVELS[request.thinking] } } : {}),
      ...(request.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
          }
        : {}),
      ...(request.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: request.jsonSchema } : {}),
    };
  }

  async generate(model: string, request: ProviderRequest): Promise<ProviderResult> {
    const response = await this.client.models.generateContent({
      model,
      contents: toContents(request.contents),
      config: this.config(request),
    });
    assertNotBlocked(response);
    const parts = (response.candidates?.[0]?.content?.parts ?? []).map(fromPart);
    return {
      text: parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join(''),
      parts,
      functionCalls: parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])),
      usage: toUsage(response.usageMetadata),
      finishReason: response.candidates?.[0]?.finishReason,
      modelVersion: response.modelVersion,
    };
  }

  async *stream(model: string, request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const stream = await this.client.models.generateContentStream({
      model,
      contents: toContents(request.contents),
      config: this.config(request),
    });
    const parts: AIPart[] = [];
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let finishReason: string | undefined;
    let modelVersion: string | undefined;
    for await (const chunk of stream) {
      assertNotBlocked(chunk);
      const candidate = chunk.candidates?.[0];
      for (const raw of candidate?.content?.parts ?? []) {
        const part = fromPart(raw);
        appendPart(parts, part);
        if (part.functionCall) yield { type: 'function_call', call: part.functionCall };
        else if (part.text && !part.thought) yield { type: 'text', text: part.text };
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      modelVersion = chunk.modelVersion ?? modelVersion;
    }
    yield { type: 'done', usage: toUsage(usage), parts, finishReason, modelVersion };
  }

  async embed(
    model: string,
    texts: string[],
    options: { taskType: EmbedTask; dimensions: number; title?: string; signal?: AbortSignal },
  ): Promise<number[][]> {
    // Each text must be its own Content: a bare string[] is treated as ONE multimodal input by gemini-embedding-2.
    const response = await this.client.models.embedContent({
      model,
      contents: texts.map((text) => ({ role: 'user', parts: [{ text }] })),
      config: {
        taskType: options.taskType,
        outputDimensionality: options.dimensions,
        ...(options.title && options.taskType === 'RETRIEVAL_DOCUMENT' ? { title: options.title } : {}),
        abortSignal: options.signal,
      },
    });
    const vectors = (response.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== options.dimensions)) {
      throw new AIError('invalid_output', `Embedding shape mismatch: sent ${texts.length}, received ${vectors.length}.`, { model });
    }
    return vectors.map(l2normalize);
  }
}

/** Used when no API key is configured: every call fails fast with a clear, non-retryable error. */
export class UnconfiguredProvider implements AIProvider {
  readonly name = 'unconfigured';
  private fail(): never {
    throw new AIError('not_configured', 'GEMINI_API_KEY is not set.');
  }
  async generate(): Promise<ProviderResult> {
    this.fail();
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<ProviderStreamChunk> {
    this.fail();
  }
  async embed(): Promise<number[][]> {
    this.fail();
  }
}
