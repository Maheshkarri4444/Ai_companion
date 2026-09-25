import { createHash } from 'node:crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function truncate(value: string | null | undefined, max: number): string {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Rough token estimate (~4 chars/token for English) used where the provider reports no usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Neutralises tag-like sequences so untrusted text (PDF content, user messages, tool output) cannot close
 * or forge the XML-ish delimiters used in prompts.
 */
export function escapePromptData(value: string): string {
  return value.replace(/<\/?(source|sources|request|learner_context|conversation_summary|tool_result)\b/gi, (m) =>
    m.replace('<', '‹'),
  );
}
