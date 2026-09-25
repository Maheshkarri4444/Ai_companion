/**
 * Heuristic flags for text that tries to instruct an AI. Flagged chunks are still usable as evidence but
 * are marked in the prompt so the model treats them with extra suspicion (docs/ARCHITECTURE.md §25).
 */
const PATTERNS = [
  /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.\n]{0,30}\b(instructions?|prompts?|rules|directions)\b/i,
  /\byou are now\b/i,
  /\b(system|developer) (prompt|message|instructions?)\b/i,
  /\breveal\b[^.\n]{0,30}\b(prompt|instructions|rules|secrets?)\b/i,
  /\bdo anything now\b|\bjailbreak/i,
  /\bnew instructions?\s*:/i,
  /<\/?\s*(system|assistant|instructions?)\s*>/i,
  /\b(respond|answer|reply) only with\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(text));
}
