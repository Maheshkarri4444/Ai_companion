import { config } from '../config/env';
import { GeminiProvider, UnconfiguredProvider } from './gemini';
import { AIGateway } from './gateway';
import { MockAIProvider } from './mock';
import type { AIProvider } from './types';

let gateway: AIGateway | null = null;

function defaultProvider(): AIProvider {
  if (config.AI_PROVIDER === 'mock') return new MockAIProvider();
  if (!config.GEMINI_API_KEY) return new UnconfiguredProvider();
  return new GeminiProvider(config.GEMINI_API_KEY);
}

function buildGateway(provider: AIProvider) {
  return new AIGateway(provider, {
    chains: {
      primary: [config.AI_MODEL_PRIMARY, ...config.aiFallbackModels],
      light: [config.AI_MODEL_LIGHT, ...config.aiLightFallbackModels],
    },
    embeddingModel: config.AI_EMBEDDING_MODEL,
    embeddingDim: config.AI_EMBEDDING_DIM,
    maxConcurrency: config.AI_MAX_CONCURRENCY,
  });
}

/** The process-wide AI gateway. */
export function ai(): AIGateway {
  gateway ??= buildGateway(defaultProvider());
  return gateway;
}

/** Swap the provider (tests use MockAIProvider). */
export function setAIProvider(provider: AIProvider): AIGateway {
  gateway = buildGateway(provider);
  return gateway;
}

export { AIError, friendlyAIMessage } from './errors';
export type { GatewayRequest, GatewayResult, GatewayStreamEvent } from './gateway';
export * from './types';
