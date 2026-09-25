import { Types } from 'mongoose';
import type { z } from 'zod';
import { getContext } from '../lib/context';
import { logger } from '../lib/logger';
import { Semaphore, sleep } from '../lib/semaphore';
import { estimateTokens, sha256, truncate } from '../lib/text';
import { AiCall } from '../models/aiCall.model';
import { AIError, classifyAIError } from './errors';
import { estimateCostUsd, resolveThinking } from './models';
import { parseStructured, toJsonSchema } from './schema';
import type {
  AIContent,
  AIFeature,
  AIFunctionCall,
  AIProvider,
  CallMeta,
  EmbedTask,
  ModelTier,
  ProviderRequest,
  ProviderResult,
  Reasoning,
  ToolDeclaration,
  Usage,
} from './types';

export interface GatewayRequest {
  feature: AIFeature;
  tier: ModelTier;
  system?: string;
  contents: AIContent[];
  tools?: ToolDeclaration[];
  reasoning?: Reasoning;
  temperature?: number;
  maxOutputTokens?: number;
  promptVersion?: string;
  meta?: CallMeta;
  /** Non-streaming: whole call. Streaming: time allowed until the first token. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Short human-readable input for the admin console (e.g. the learner's question). */
  inputPreview?: string;
  /** Diagnostics stored with the call (retrieval trace, tool calls, …). */
  metadata?: Record<string, unknown>;
}

export interface GatewayResult extends ProviderResult {
  model: string;
  aiCallId: string;
  latencyMs: number;
  ttftMs: number | null;
  costUsd: number;
  fallbackUsed: boolean;
}

export type GatewayStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'function_call'; call: AIFunctionCall }
  | { type: 'done'; result: GatewayResult };

interface Attempt {
  model: string;
  status: 'success' | 'error';
  kind?: string;
  ms: number;
  message?: string;
}

export interface GatewayOptions {
  chains: Record<ModelTier, string[]>;
  embeddingModel: string;
  embeddingDim: number;
  maxConcurrency: number;
}

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const STREAM_IDLE_TIMEOUT_MS = 30_000;
const EMBED_BATCH = 50;
const QUERY_CACHE_TTL_MS = 10 * 60_000;

/** Rejects as soon as `signal` aborts, even if the provider ignores the signal (a hung SDK call must not hang us). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function linkedController(parent?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) onAbort();
    else parent.addEventListener('abort', onAbort, { once: true });
  }
  return { controller, dispose: () => parent?.removeEventListener('abort', onAbort) };
}

/**
 * The only path from product code to a model. Owns timeouts, retries, model fallback, a per-model circuit
 * breaker, concurrency limits, structured-output validation and the `ai_calls` audit trail
 * (docs/ARCHITECTURE.md §12, §23).
 */
export class AIGateway {
  private readonly breakers = new Map<string, { failures: number; openUntil: number; lastError?: string }>();
  private readonly generationLimiter: Semaphore;
  private readonly embeddingLimiter = new Semaphore(2);
  private readonly queryCache = new Map<string, { vector: number[]; at: number }>();

  constructor(
    readonly provider: AIProvider,
    private readonly options: GatewayOptions,
  ) {
    this.generationLimiter = new Semaphore(options.maxConcurrency);
  }

  /** Healthy models first; models with an open breaker are kept at the end as a last resort. */
  chain(tier: ModelTier): string[] {
    const models = [...new Set(this.options.chains[tier])];
    const now = Date.now();
    const isOpen = (m: string) => (this.breakers.get(m)?.openUntil ?? 0) > now;
    return [...models.filter((m) => !isOpen(m)), ...models.filter(isOpen)];
  }

  status() {
    const now = Date.now();
    return {
      provider: this.provider.name,
      chains: this.options.chains,
      embeddingModel: this.options.embeddingModel,
      inFlight: this.generationLimiter.inFlight,
      breakers: [...this.breakers.entries()].map(([model, b]) => ({
        model,
        failures: b.failures,
        open: b.openUntil > now,
        reopensInSec: b.openUntil > now ? Math.round((b.openUntil - now) / 1000) : 0,
        lastError: b.lastError ?? null,
      })),
    };
  }

  private recordSuccess(model: string) {
    this.breakers.delete(model);
  }

  /**
   * Quota (429), capacity (503 "high demand") and missing-model errors persist for minutes, so the model is
   * parked immediately — a 503 can take 10 s to arrive, and nobody should pay that twice. Other failures
   * (timeouts, unknown) open the breaker after BREAKER_THRESHOLD consecutive errors.
   */
  private recordFailure(model: string, err: AIError) {
    const breaker = this.breakers.get(model) ?? { failures: 0, openUntil: 0 };
    breaker.failures += 1;
    breaker.lastError = err.kind;
    const cooldown =
      err.kind === 'model_not_found'
        ? 10 * BREAKER_COOLDOWN_MS
        : err.kind === 'rate_limited'
          ? Math.max(err.retryAfterMs ?? 0, BREAKER_COOLDOWN_MS)
          : err.kind === 'unavailable'
            ? BREAKER_COOLDOWN_MS / 2
            : breaker.failures >= BREAKER_THRESHOLD
              ? BREAKER_COOLDOWN_MS
              : 0;
    if (cooldown) breaker.openUntil = Date.now() + cooldown;
    this.breakers.set(model, breaker);
  }

  /**
   * Shared retry/fallback policy. Returns `null` to move to the next model, `'retry'` to retry the same
   * model, or throws when no other model can help.
   */
  private async decide(err: AIError, attempt: number, chainLength: number): Promise<'retry' | null> {
    if (!err.tryNextModel) throw err;
    if (err.kind === 'unavailable' && chainLength === 1 && attempt === 0) {
      await sleep(500 + Math.random() * 500);
      return 'retry';
    }
    return null;
  }

  private log(entry: {
    request: GatewayRequest;
    operation: 'generate' | 'stream' | 'structured' | 'embed';
    model: string | null;
    attempts: Attempt[];
    chainHead: string;
    latencyMs: number;
    ttftMs?: number | null;
    usage?: Usage;
    error?: AIError;
    output?: string;
    extraMetadata?: Record<string, unknown>;
    aiCallId?: Types.ObjectId;
  }) {
    const { request, model } = entry;
    const usage = entry.usage ?? { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 };
    const costUsd = model ? estimateCostUsd(model, usage) : 0;
    const meta = request.meta ?? {};
    const id = entry.aiCallId ?? new Types.ObjectId();
    const toId = (v?: string | null) => (v && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null);
    AiCall.create({
      _id: id,
      feature: request.feature,
      operation: entry.operation,
      provider: this.provider.name,
      model,
      attempts: entry.attempts,
      retries: Math.max(0, entry.attempts.length - 1),
      fallbackUsed: Boolean(model && model !== entry.chainHead),
      status: entry.error ? 'error' : 'success',
      errorKind: entry.error?.kind ?? null,
      errorMessage: entry.error ? truncate(entry.error.message, 500) : null,
      latencyMs: entry.latencyMs,
      ttftMs: entry.ttftMs ?? null,
      usage: { ...usage, estimated: Boolean(usage.estimated) },
      costUsd,
      promptVersion: request.promptVersion ?? null,
      ownerId: toId(meta.ownerId),
      projectId: toId(meta.projectId),
      conversationId: toId(meta.conversationId),
      messageId: toId(meta.messageId),
      jobId: toId(meta.jobId),
      traceId: meta.traceId ?? getContext()?.requestId ?? null,
      inputPreview: request.inputPreview ? truncate(request.inputPreview, 400) : null,
      outputPreview: entry.output ? truncate(entry.output, 600) : null,
      metadata: { ...(request.metadata ?? {}), ...(entry.extraMetadata ?? {}) },
    }).catch((err) => logger.warn({ err }, 'Failed to record AI call'));
    return { aiCallId: id.toString(), costUsd };
  }

  private async execute(request: GatewayRequest, jsonSchema?: Record<string, unknown>) {
    const started = Date.now();
    const attempts: Attempt[] = [];
    const chain = this.chain(request.tier);
    let lastError: AIError | undefined;
    for (const model of chain) {
      let thinking = resolveThinking(model, request.reasoning);
      for (let attempt = 0; attempt < 3; attempt++) {
        const t0 = Date.now();
        const { controller, dispose } = linkedController(request.signal);
        const timeout = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const timer = setTimeout(
          () => controller.abort(new AIError('timeout', `${model} did not respond within ${timeout} ms`, { model })),
          timeout,
        );
        try {
          const providerRequest: ProviderRequest = {
            system: request.system,
            contents: request.contents,
            tools: request.tools,
            thinking,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            jsonSchema,
            signal: controller.signal,
          };
          const result = await this.generationLimiter.run(() => raceAbort(this.provider.generate(model, providerRequest), controller.signal));
          attempts.push({ model, status: 'success', ms: Date.now() - t0 });
          this.recordSuccess(model);
          return { result, model, attempts, started, chainHead: chain[0] };
        } catch (e) {
          const err = classifyAIError(e, model, controller.signal);
          attempts.push({ model, status: 'error', kind: err.kind, ms: Date.now() - t0, message: truncate(err.message, 240) });
          lastError = err;
          if (err.kind === 'unsupported_config' && thinking) {
            thinking = undefined; // same model, without the rejected thinking config
            continue;
          }
          try {
            this.recordFailure(model, err);
            if ((await this.decide(err, attempt, chain.length)) === 'retry') continue;
          } catch {
            throw Object.assign(err, { attempts, started, chainHead: chain[0] });
          }
          break;
        } finally {
          clearTimeout(timer);
          dispose();
        }
      }
    }
    const err = lastError ?? new AIError('unknown', 'No model available');
    throw Object.assign(err, { attempts, started, chainHead: chain[0] });
  }

  private failureLog(request: GatewayRequest, operation: 'generate' | 'structured', e: unknown) {
    const err = e as AIError & { attempts?: Attempt[]; started?: number; chainHead?: string };
    this.log({
      request,
      operation,
      model: err.attempts?.at(-1)?.model ?? null,
      attempts: err.attempts ?? [],
      chainHead: err.chainHead ?? '',
      latencyMs: err.started ? Date.now() - err.started : 0,
      error: err instanceof AIError ? err : classifyAIError(err),
    });
  }

  async generate(request: GatewayRequest): Promise<GatewayResult> {
    let run;
    try {
      run = await this.execute(request);
    } catch (e) {
      this.failureLog(request, 'generate', e);
      throw e;
    }
    const latencyMs = Date.now() - run.started;
    const { aiCallId, costUsd } = this.log({
      request,
      operation: 'generate',
      model: run.model,
      attempts: run.attempts,
      chainHead: run.chainHead,
      latencyMs,
      usage: run.result.usage,
      output: run.result.text,
    });
    return { ...run.result, model: run.model, aiCallId, latencyMs, ttftMs: null, costUsd, fallbackUsed: run.model !== run.chainHead };
  }

  /** JSON output validated with zod; one repair round-trip before giving up. Nothing unvalidated is returned. */
  async structured<T>(request: GatewayRequest & { schema: z.ZodType<T> }): Promise<GatewayResult & { data: T }> {
    const jsonSchema = toJsonSchema(request.schema);
    let contents = request.contents;
    for (let round = 0; round < 2; round++) {
      let run;
      try {
        run = await this.execute({ ...request, contents }, jsonSchema);
      } catch (e) {
        this.failureLog(request, 'structured', e);
        throw e;
      }
      const parsed = parseStructured(run.result.text, request.schema);
      const latencyMs = Date.now() - run.started;
      const { aiCallId, costUsd } = this.log({
        request,
        operation: 'structured',
        model: run.model,
        attempts: run.attempts,
        chainHead: run.chainHead,
        latencyMs,
        usage: run.result.usage,
        output: run.result.text,
        extraMetadata: { validation: parsed.ok ? 'passed' : 'failed', ...(parsed.ok ? {} : { validationError: parsed.error }), repairRound: round },
      });
      if (parsed.ok) {
        return { ...run.result, data: parsed.data, model: run.model, aiCallId, latencyMs, ttftMs: null, costUsd, fallbackUsed: run.model !== run.chainHead };
      }
      contents = [
        ...request.contents,
        { role: 'model', parts: [{ text: run.result.text.slice(0, 20_000) }] },
        {
          role: 'user',
          parts: [{ text: `That reply did not match the required JSON schema (${parsed.error}). Reply again with only the corrected JSON.` }],
        },
      ];
    }
    throw new AIError('invalid_output', 'The model did not return valid structured output.');
  }

  /**
   * Streams text/tool-call events. Retries and model fallback happen only before the first event; once
   * output has reached the caller, a failure is surfaced (partial text cannot be retried transparently).
   */
  async *stream(request: GatewayRequest): AsyncGenerator<GatewayStreamEvent> {
    const started = Date.now();
    const attempts: Attempt[] = [];
    const chain = this.chain(request.tier);
    let lastError: AIError | undefined;

    for (const model of chain) {
      let thinking = resolveThinking(model, request.reasoning);
      for (let attempt = 0; attempt < 3; attempt++) {
        const t0 = Date.now();
        const { controller, dispose } = linkedController(request.signal);
        const firstTimeout = request.timeoutMs ?? 45_000;
        let timer = setTimeout(
          () => controller.abort(new AIError('timeout', `${model} produced no output within ${firstTimeout} ms`, { model })),
          firstTimeout,
        );
        let ttftMs: number | null = null;
        let emitted = false;
        let settled = false;
        let text = '';
        const release = await this.generationLimiter.acquire();
        try {
          const providerRequest: ProviderRequest = {
            system: request.system,
            contents: request.contents,
            tools: request.tools,
            thinking,
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            signal: controller.signal,
          };
          for await (const chunk of this.provider.stream(model, providerRequest)) {
            // Stop promptly on Stop/timeout even if the provider keeps yielding buffered chunks.
            controller.signal.throwIfAborted();
            if (chunk.type === 'done') {
              attempts.push({ model, status: 'success', ms: Date.now() - t0 });
              this.recordSuccess(model);
              settled = true;
              const latencyMs = Date.now() - started;
              const { aiCallId, costUsd } = this.log({
                request,
                operation: 'stream',
                model,
                attempts,
                chainHead: chain[0],
                latencyMs,
                ttftMs,
                usage: chunk.usage,
                output: text,
              });
              yield {
                type: 'done',
                result: {
                  text,
                  parts: chunk.parts,
                  functionCalls: chunk.parts.flatMap((p) => (p.functionCall ? [p.functionCall] : [])),
                  usage: chunk.usage,
                  finishReason: chunk.finishReason,
                  modelVersion: chunk.modelVersion,
                  model,
                  aiCallId,
                  latencyMs,
                  ttftMs,
                  costUsd,
                  fallbackUsed: model !== chain[0],
                },
              };
              return;
            }
            if (!emitted) {
              emitted = true;
              ttftMs = Date.now() - started;
            }
            clearTimeout(timer);
            timer = setTimeout(
              () => controller.abort(new AIError('timeout', `${model} stalled mid-stream`, { model })),
              STREAM_IDLE_TIMEOUT_MS,
            );
            if (chunk.type === 'text') text += chunk.text;
            yield chunk;
          }
          throw new AIError('invalid_output', 'The stream ended without completing.', { model });
        } catch (e) {
          const err = classifyAIError(e, model, controller.signal);
          attempts.push({ model, status: 'error', kind: err.kind, ms: Date.now() - t0, message: truncate(err.message, 240) });
          lastError = err;
          if (emitted || !err.tryNextModel) {
            settled = true;
            if (err.kind !== 'aborted') this.recordFailure(model, err);
            this.log({ request, operation: 'stream', model, attempts, chainHead: chain[0], latencyMs: Date.now() - started, ttftMs, error: err, output: text });
            throw err;
          }
          if (err.kind === 'unsupported_config' && thinking) {
            thinking = undefined;
            continue;
          }
          this.recordFailure(model, err);
          if ((await this.decide(err, attempt, chain.length)) === 'retry') continue;
          break;
        } finally {
          clearTimeout(timer);
          release();
          dispose();
          if (!settled) {
            // The consumer stopped iterating (e.g. the learner pressed Stop): cancel upstream and keep a record.
            controller.abort(new AIError('aborted', 'Consumer stopped the stream.'));
            if (emitted) {
              this.log({
                request,
                operation: 'stream',
                model,
                attempts: [...attempts, { model, status: 'error', kind: 'aborted', ms: Date.now() - t0 }],
                chainHead: chain[0],
                latencyMs: Date.now() - started,
                ttftMs,
                error: new AIError('aborted', 'Stopped by the consumer.'),
                output: text,
              });
            }
          }
        }
      }
    }
    const err = lastError ?? new AIError('unknown', 'No model available');
    this.log({ request, operation: 'stream', model: attempts.at(-1)?.model ?? null, attempts, chainHead: chain[0] ?? '', latencyMs: Date.now() - started, error: err });
    throw err;
  }

  /**
   * Embeddings are never "fallen back" to another model — vectors from different models are not comparable.
   * Batches are retried with backoff instead. Single query embeddings are cached briefly.
   */
  async embed(
    texts: string[],
    options: { feature: AIFeature; taskType: EmbedTask; title?: string; meta?: CallMeta; signal?: AbortSignal },
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = this.options.embeddingModel;
    const cacheKey =
      options.taskType === 'RETRIEVAL_QUERY' && texts.length === 1 ? sha256(`${model}|${this.options.embeddingDim}|${texts[0]}`) : null;
    if (cacheKey) {
      const hit = this.queryCache.get(cacheKey);
      if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return [hit.vector];
    }

    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const started = Date.now();
      const attempts: Attempt[] = [];
      const request: GatewayRequest = { feature: options.feature, tier: 'light', contents: [], meta: options.meta, inputPreview: batch[0] };
      const usage: Usage = { inputTokens: batch.reduce((n, t) => n + estimateTokens(t), 0), outputTokens: 0, thinkingTokens: 0, totalTokens: 0, estimated: true };
      usage.totalTokens = usage.inputTokens;
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        try {
          const result = await this.embeddingLimiter.run(() =>
            this.provider.embed(model, batch, {
              taskType: options.taskType,
              dimensions: this.options.embeddingDim,
              title: options.title,
              signal: options.signal,
            }),
          );
          attempts.push({ model, status: 'success', ms: Date.now() - t0 });
          vectors.push(...result);
          this.log({ request, operation: 'embed', model, attempts, chainHead: model, latencyMs: Date.now() - started, usage, extraMetadata: { batchSize: batch.length } });
          break;
        } catch (e) {
          const err = classifyAIError(e, model, options.signal);
          attempts.push({ model, status: 'error', kind: err.kind, ms: Date.now() - t0, message: truncate(err.message, 240) });
          if (!err.retryable || attempt >= 2) {
            this.log({ request, operation: 'embed', model, attempts, chainHead: model, latencyMs: Date.now() - started, error: err, extraMetadata: { batchSize: batch.length } });
            throw err;
          }
          await sleep(Math.min(err.retryAfterMs ?? 0, 8000) || 700 * 2 ** attempt, options.signal);
        }
      }
    }

    if (cacheKey) {
      if (this.queryCache.size > 500) this.queryCache.delete(this.queryCache.keys().next().value as string);
      this.queryCache.set(cacheKey, { vector: vectors[0], at: Date.now() });
    }
    return vectors;
  }
}
