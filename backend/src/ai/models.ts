import type { Reasoning, Usage } from './types';

interface ModelInfo {
  /** Supported thinking levels, or null when the model does not accept a thinking config. */
  thinking: Reasoning[] | null;
  /** USD per 1M tokens (paid-tier list price; thinking tokens bill as output). */
  inputPer1M: number;
  outputPer1M: number;
}

const ALL: Reasoning[] = ['minimal', 'low', 'medium', 'high'];

/**
 * Capabilities verified against the API on 2026-09-25; prices from ai.google.dev/gemini-api/docs/pricing
 * (flash promo pricing through 2026-12-31). Unknown models fall back to the most conservative behaviour.
 */
const MODELS: Record<string, ModelInfo> = {
  'gemini-3.8-flash': { thinking: ['low', 'medium', 'high'], inputPer1M: 0.75, outputPer1M: 3.75 },
  'gemini-3.7-flash': { thinking: ['low', 'medium', 'high'], inputPer1M: 0.75, outputPer1M: 3.75 },
  'gemini-3.6-flash': { thinking: ALL, inputPer1M: 0.75, outputPer1M: 3.75 },
  'gemini-3.5-flash': { thinking: ['low', 'medium', 'high'], inputPer1M: 1.5, outputPer1M: 9 },
  'gemini-3-flash-preview': { thinking: ALL, inputPer1M: 0.5, outputPer1M: 3 },
  'gemini-3.5-flash-lite': { thinking: null, inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-3.1-flash-lite': { thinking: null, inputPer1M: 0.25, outputPer1M: 1.5 },
  'gemini-flash-lite-latest': { thinking: null, inputPer1M: 0.3, outputPer1M: 2.5 },
  'gemini-embedding-2': { thinking: null, inputPer1M: 0.2, outputPer1M: 0 },
  'gemini-embedding-001': { thinking: null, inputPer1M: 0.15, outputPer1M: 0 },
  mock: { thinking: ALL, inputPer1M: 0, outputPer1M: 0 },
};

export function modelInfo(model: string): ModelInfo | undefined {
  return MODELS[model] ?? Object.entries(MODELS).find(([name]) => model.startsWith(name))?.[1];
}

/** Picks the requested level if supported, otherwise the nearest supported level above (or the highest). */
export function resolveThinking(model: string, requested?: Reasoning): Reasoning | undefined {
  if (!requested) return undefined;
  const info = modelInfo(model);
  if (!info) return requested; // unknown: try it; the gateway retries without thinking on rejection
  if (!info.thinking) return undefined;
  if (info.thinking.includes(requested)) return requested;
  const order = ALL.indexOf(requested);
  return info.thinking.find((level) => ALL.indexOf(level) >= order) ?? info.thinking[info.thinking.length - 1];
}

export function estimateCostUsd(model: string, usage: Usage): number {
  const info = modelInfo(model);
  if (!info) return 0;
  const cost = (usage.inputTokens * info.inputPer1M + (usage.outputTokens + usage.thinkingTokens) * info.outputPer1M) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
