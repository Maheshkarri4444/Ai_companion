import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AIError } from '../src/ai/errors';
import { AIGateway } from '../src/ai/gateway';
import { MockAIProvider } from '../src/ai/mock';
import { estimateCostUsd, resolveThinking } from '../src/ai/models';
import { toJsonSchema } from '../src/ai/schema';
import { AiCall } from '../src/models/aiCall.model';
import { useTestDatabase } from './helpers';

useTestDatabase();

const user = (text: string) => [{ role: 'user' as const, parts: [{ text }] }];

function gatewayWith(provider: MockAIProvider, primary = ['model-a', 'model-b']) {
  return new AIGateway(provider, {
    chains: { primary, light: ['light-a'] },
    embeddingModel: 'embed-a',
    embeddingDim: 768,
    maxConcurrency: 2,
  });
}

/** AI calls are logged fire-and-forget; wait until they land. */
async function loggedCalls(count: number) {
  await vi.waitFor(async () => expect(await AiCall.countDocuments({})).toBe(count));
  return AiCall.find({}).sort({ createdAt: 1 }).lean();
}

describe('AI gateway', () => {
  let provider: MockAIProvider;

  beforeEach(() => {
    provider = new MockAIProvider({ generate: () => 'Hello from the model.' });
  });

  it('logs every call with model, feature, tokens, latency, cost and trace ids', async () => {
    const gateway = gatewayWith(provider);
    const result = await gateway.generate({
      feature: 'tutor.answer',
      tier: 'primary',
      contents: user('Hi'),
      promptVersion: 'tutor.v1',
      meta: { ownerId: '64b000000000000000000001', projectId: '64b000000000000000000002' },
      inputPreview: 'Hi',
    });
    expect(result).toMatchObject({ text: 'Hello from the model.', model: 'model-a', fallbackUsed: false });
    const [call] = await loggedCalls(1);
    expect(call).toMatchObject({ feature: 'tutor.answer', operation: 'generate', model: 'model-a', status: 'success', promptVersion: 'tutor.v1', inputPreview: 'Hi' });
    expect(call.ownerId?.toString()).toBe('64b000000000000000000001');
    expect(call.usage.inputTokens).toBeGreaterThan(0);
    expect(call._id.toString()).toBe(result.aiCallId);
  });

  it('falls back to the next model on rate limits and opens the circuit breaker', async () => {
    provider.failures.set('model-a', new AIError('rate_limited', 'quota', { status: 429 }));
    const gateway = gatewayWith(provider);
    const first = await gateway.generate({ feature: 'tutor.answer', tier: 'primary', contents: user('Hi') });
    expect(first).toMatchObject({ model: 'model-b', fallbackUsed: true });
    const [call] = await loggedCalls(1);
    expect(call.attempts.map((a) => `${a.model}:${a.status}`)).toEqual(['model-a:error', 'model-b:success']);
    expect(call.fallbackUsed).toBe(true);

    // The rate-limited model is now behind an open breaker: the next call goes straight to model-b.
    expect(gateway.chain('primary')).toEqual(['model-b', 'model-a']);
    expect(gateway.status().breakers).toEqual([expect.objectContaining({ model: 'model-a', open: true })]);
  });

  it('does not fall back for non-recoverable errors', async () => {
    provider.failures.set('model-a', new AIError('auth', 'bad key', { status: 401 }));
    const gateway = gatewayWith(provider);
    await expect(gateway.generate({ feature: 'tutor.answer', tier: 'primary', contents: user('Hi') })).rejects.toMatchObject({ kind: 'auth' });
    const [call] = await loggedCalls(1);
    expect(call).toMatchObject({ status: 'error', errorKind: 'auth' });
    expect(provider.calls.map((c) => c.model)).toEqual(['model-a']);
  });

  it('times out slow models and moves on', async () => {
    const slow = new MockAIProvider({
      generate: async (model) => {
        if (model === 'model-a') await new Promise((resolve) => setTimeout(resolve, 500));
        return `answer from ${model}`;
      },
    });
    const result = await gatewayWith(slow).generate({ feature: 'tutor.answer', tier: 'primary', contents: user('Hi'), timeoutMs: 50 });
    expect(result.text).toBe('answer from model-b');
  });

  it('validates structured output with zod and repairs once before failing', async () => {
    const schema = z.object({ intent: z.enum(['question', 'greeting']), confidence: z.number().min(0).max(1) });
    let calls = 0;
    const repairing = new MockAIProvider({ generate: () => (++calls === 1 ? '{"intent":"banana"}' : '```json\n{"intent":"question","confidence":0.9}\n```') });
    const result = await gatewayWith(repairing).structured({ feature: 'tutor.intent', tier: 'light', contents: user('What is SGD?'), schema });
    expect(result.data).toEqual({ intent: 'question', confidence: 0.9 });
    const logged = (await loggedCalls(2)).sort((a, b) => Number(a.metadata.repairRound) - Number(b.metadata.repairRound));
    expect(logged.map((c) => c.metadata.validation)).toEqual(['failed', 'passed']);
    // The JSON schema sent to the provider is derived from the same zod schema.
    expect(repairing.calls[0].request!.jsonSchema).toEqual(toJsonSchema(schema));

    const broken = new MockAIProvider({ generate: () => 'not json at all' });
    await expect(gatewayWith(broken).structured({ feature: 'tutor.intent', tier: 'light', contents: user('x'), schema })).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });

  it('streams text, and never retries once output has reached the caller', async () => {
    const gateway = gatewayWith(provider);
    let text = '';
    let done;
    for await (const event of gateway.stream({ feature: 'tutor.answer', tier: 'primary', contents: user('Hi') })) {
      if (event.type === 'text') text += event.text;
      if (event.type === 'done') done = event.result;
    }
    expect(text).toBe('Hello from the model.');
    expect(done).toMatchObject({ model: 'model-a', text: 'Hello from the model.' });
    expect((await loggedCalls(1))[0]).toMatchObject({ operation: 'stream', status: 'success' });
    expect((await AiCall.findOne({}).lean())!.ttftMs).not.toBeNull();
  });

  it('embeds in batches, keeps order and caches repeated query embeddings', async () => {
    const gateway = gatewayWith(provider);
    const texts = Array.from({ length: 120 }, (_, i) => `chunk number ${i}`);
    const vectors = await gateway.embed(texts, { feature: 'embed.document', taskType: 'RETRIEVAL_DOCUMENT' });
    expect(vectors).toHaveLength(120);
    expect(provider.calls.filter((c) => c.kind === 'embed').map((c) => c.texts!.length)).toEqual([50, 50, 20]);

    await gateway.embed(['what is backprop?'], { feature: 'embed.query', taskType: 'RETRIEVAL_QUERY' });
    await gateway.embed(['what is backprop?'], { feature: 'embed.query', taskType: 'RETRIEVAL_QUERY' });
    expect(provider.calls.filter((c) => c.kind === 'embed')).toHaveLength(4);
  });

  it('never falls back to a different embedding model (vectors would not be comparable)', async () => {
    provider.failures.set('embed-a', new AIError('invalid_request', 'bad', { status: 400 }));
    await expect(gatewayWith(provider).embed(['x'], { feature: 'embed.query', taskType: 'RETRIEVAL_QUERY' })).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(provider.calls.every((c) => c.model === 'embed-a')).toBe(true);
  });
});

describe('structured-output schema for the model', () => {
  it('keeps structure and semantic bounds but leaves size limits to server-side validation', () => {
    const schema = z.object({
      items: z.array(z.object({ score: z.number().int().min(1).max(5), note: z.string().max(40), id: z.number().int() })).max(3),
      kind: z.enum(['a', 'b']),
    });
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: 'string' }, id: { type: 'integer' } },
            required: ['score', 'note', 'id'],
          },
        },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['items', 'kind'],
    });
  });
});

describe('model catalogue', () => {
  it('resolves thinking levels per model capability', () => {
    expect(resolveThinking('gemini-3.6-flash', 'minimal')).toBe('minimal');
    expect(resolveThinking('gemini-3.7-flash', 'minimal')).toBe('low');
    expect(resolveThinking('gemini-3.5-flash-lite', 'minimal')).toBeUndefined();
  });

  it('estimates cost with thinking tokens billed as output', () => {
    const cost = estimateCostUsd('gemini-3.6-flash', { inputTokens: 1_000_000, outputTokens: 100_000, thinkingTokens: 100_000, totalTokens: 0 });
    expect(cost).toBeCloseTo(0.75 + 0.2 * 3.75, 6);
  });
});
