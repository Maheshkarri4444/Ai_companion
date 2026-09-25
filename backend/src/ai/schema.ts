import { z } from 'zod';

/** Keywords the Gemini structured-output grammar rejects outright. */
const UNSUPPORTED_KEYS = new Set(['$schema', '$id', 'additionalProperties', 'default']);
/**
 * Size limits are stripped from the model-facing schema: combined on arrays of objects they make the
 * constrained decoder reject the request (verified 2026-09-25: `maxItems` on an object array → 400
 * INVALID_ARGUMENT), and they are not needed there — zod enforces every limit on the result server-side,
 * with a repair round-trip. The model sees structure; the server enforces rules.
 */
const SERVER_SIDE_ONLY = new Set(['maxItems', 'minItems', 'maxLength', 'minLength']);
const SAFE_INT = Number.MAX_SAFE_INTEGER;

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYS.has(key) || SERVER_SIDE_ONLY.has(key)) continue;
      // zod emits ±MAX_SAFE_INTEGER bounds for .int(); they carry no information.
      if ((key === 'minimum' || key === 'maximum') && Math.abs(Number(value)) >= SAFE_INT) continue;
      out[key] = clean(value);
    }
    return out;
  }
  return node;
}

/** zod → the JSON Schema subset sent to the model for structured output. Schemas must not use transforms. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' })) as Record<string, unknown>;
}

/** Models occasionally wrap JSON in code fences or prose; take the outermost JSON value. */
export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('No JSON value found in model output');
  }
}

export function parseStructured<T>(text: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  };
}
