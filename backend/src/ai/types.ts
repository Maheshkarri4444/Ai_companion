/**
 * Provider-neutral AI types. Parts mirror the common shape of multimodal chat APIs; each provider maps them
 * to its own wire format (docs/ARCHITECTURE.md §12).
 */

/**
 * Every AI call is tagged with the product feature it serves (cost, latency and quality are reported per
 * feature). The catalogue already covers the assessment and recommendation phases so they only add prompts.
 */
export const AI_FEATURES = [
  'tutor.answer',
  'tutor.intent',
  'tutor.summarize',
  'tutor.title',
  'tutor.memory',
  'material.ocr',
  'material.concepts',
  'embed.document',
  'embed.query',
  'embed.memory',
  'quiz.generate',
  'quiz.grade',
  'insight.generate',
  'recommend.generate',
  'eval.judge',
  'system.probe',
] as const;
export type AIFeature = (typeof AI_FEATURES)[number];

export type ModelTier = 'primary' | 'light';
export type Reasoning = 'minimal' | 'low' | 'medium' | 'high';
export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

export interface AIFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AIPart {
  text?: string;
  /** Model reasoning text (never shown to users or forwarded). */
  thought?: boolean;
  /** Opaque provider signature that must be echoed back in multi-turn tool use. */
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: AIFunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface AIContent {
  role: 'user' | 'model';
  parts: AIPart[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

/** Identifiers stored with every AI call so it can be traced back to a user, Project, request or job. */
export interface CallMeta {
  ownerId?: string | null;
  projectId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  jobId?: string | null;
  traceId?: string | null;
}

export interface ProviderRequest {
  system?: string;
  contents: AIContent[];
  tools?: ToolDeclaration[];
  thinking?: Reasoning;
  temperature?: number;
  maxOutputTokens?: number;
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ProviderResult {
  text: string;
  parts: AIPart[];
  functionCalls: AIFunctionCall[];
  usage: Usage;
  finishReason?: string;
  modelVersion?: string;
}

export type ProviderStreamChunk =
  | { type: 'text'; text: string }
  | { type: 'function_call'; call: AIFunctionCall }
  | { type: 'done'; usage: Usage; parts: AIPart[]; finishReason?: string; modelVersion?: string };

export interface AIProvider {
  readonly name: string;
  generate(model: string, request: ProviderRequest): Promise<ProviderResult>;
  stream(model: string, request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
  embed(
    model: string,
    texts: string[],
    options: { taskType: EmbedTask; dimensions: number; title?: string; signal?: AbortSignal },
  ): Promise<number[][]>;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 });
