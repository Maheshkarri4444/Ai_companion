export type AIErrorKind =
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'model_not_found'
  | 'unsupported_config'
  | 'invalid_request'
  | 'blocked'
  | 'invalid_output'
  | 'aborted'
  | 'auth'
  | 'not_configured'
  | 'unknown';

const RETRYABLE: AIErrorKind[] = ['rate_limited', 'unavailable', 'timeout', 'unknown'];
/** Kinds where a different model may succeed. */
const TRY_NEXT_MODEL: AIErrorKind[] = ['rate_limited', 'unavailable', 'timeout', 'model_not_found', 'invalid_request', 'unknown'];

export class AIError extends Error {
  readonly kind: AIErrorKind;
  readonly status?: number;
  readonly model?: string;
  readonly retryAfterMs?: number;

  constructor(kind: AIErrorKind, message: string, options: { status?: number; model?: string; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AIError';
    this.kind = kind;
    this.status = options.status;
    this.model = options.model;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable() {
    return RETRYABLE.includes(this.kind);
  }

  get tryNextModel() {
    return TRY_NEXT_MODEL.includes(this.kind);
  }
}

function parseRetryAfter(message: string): number | undefined {
  const match = message.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) ?? message.match(/retry in ([\d.]+)\s*s/i);
  return match ? Math.round(parseFloat(match[1]) * 1000) : undefined;
}

/** Normalises SDK, network and abort errors into a small, actionable vocabulary. */
export function classifyAIError(err: unknown, model?: string, signal?: AbortSignal): AIError {
  if (err instanceof AIError) return err;
  if (signal?.aborted && signal.reason instanceof AIError) return signal.reason;

  const e = err as { name?: string; status?: number; message?: string; code?: string; cause?: { code?: string } };
  const message = e?.message ?? String(err);
  if (e?.name === 'AbortError' || /aborted/i.test(message)) {
    return new AIError('aborted', 'The request was cancelled.', { model, cause: err });
  }
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === 429) return new AIError('rate_limited', message, { status, model, retryAfterMs: parseRetryAfter(message), cause: err });
  if (status && [500, 502, 503, 504].includes(status)) return new AIError('unavailable', message, { status, model, cause: err });
  if (status === 404) return new AIError('model_not_found', message, { status, model, cause: err });
  if (status === 401 || status === 403) return new AIError('auth', message, { status, model, cause: err });
  if (status === 400) {
    const kind = /thinking/i.test(message) ? 'unsupported_config' : 'invalid_request';
    return new AIError(kind, message, { status, model, cause: err });
  }
  const code = e?.code ?? e?.cause?.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) {
    return new AIError('unavailable', message, { model, cause: err });
  }
  if (/fetch failed|network|socket hang up/i.test(message)) return new AIError('unavailable', message, { model, cause: err });
  return new AIError('unknown', message, { model, cause: err });
}

/** Short, learner-facing explanation (never leaks provider internals). */
export function friendlyAIMessage(kind: AIErrorKind): string {
  switch (kind) {
    case 'rate_limited':
    case 'unavailable':
      return 'The AI service is very busy right now. Please try again in a moment.';
    case 'timeout':
      return 'The AI took too long to respond. Please try again.';
    case 'blocked':
      return "I can't help with that request.";
    case 'not_configured':
    case 'auth':
      return 'The AI service is not configured correctly. Please contact an administrator.';
    case 'aborted':
      return 'The response was stopped.';
    default:
      return 'Something went wrong while generating a response. Please try again.';
  }
}
