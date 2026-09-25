import type { GroundingStatus } from '../../models/message.model';

/*
 * The model reports its grounding status and follow-up questions with control markers ([[GROUNDED]],
 * [[FOLLOWUPS: a | b | c]]) and cites evidence as [S#]. Markers are stripped from the stream before the
 * learner sees it; citations are validated against the sources actually provided (docs/ARCHITECTURE.md §14).
 */

const STATUS_MARKERS: Record<string, GroundingStatus> = {
  GROUNDED: 'grounded',
  PARTIAL: 'partial',
  INSUFFICIENT: 'insufficient',
  GENERAL: 'general',
  CHAT: 'conversational',
};
const MAX_MARKER_LENGTH = 700;

function isMarker(body: string) {
  return body.trim().toUpperCase() in STATUS_MARKERS || /^\s*FOLLOW[-_ ]?UPS?\s*:/i.test(body);
}

/** True when an unterminated "[[…" could still be (the start of) a marker — used when output was cut off. */
function couldBeMarker(body: string) {
  const b = body.replace(/\]$/, '').trim().toUpperCase();
  if (!b || /^FOLLOW[-_ ]?UPS?\s*:/.test(b)) return true;
  return [...Object.keys(STATUS_MARKERS), 'FOLLOWUPS:'].some((marker) => marker.startsWith(b));
}

/** Incremental filter for streamed text: holds back anything that might be the start of a marker. */
export class MarkerStripper {
  private buffer = '';
  private started = false;
  readonly markers: string[] = [];

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    for (;;) {
      const open = this.buffer.indexOf('[[');
      if (open === -1) {
        // A trailing "[" may be the first half of "[[" — keep it for the next chunk.
        const keep = this.buffer.endsWith('[') ? 1 : 0;
        out += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        break;
      }
      out += this.buffer.slice(0, open);
      const rest = this.buffer.slice(open);
      const close = rest.indexOf(']]');
      if (close === -1) {
        if (rest.length > MAX_MARKER_LENGTH) {
          out += rest; // not a marker after all
          this.buffer = '';
        } else {
          this.buffer = rest;
        }
        break;
      }
      const body = rest.slice(2, close);
      if (isMarker(body)) this.markers.push(body.trim());
      else out += rest.slice(0, close + 2);
      this.buffer = rest.slice(close + 2);
    }
    return this.emit(out);
  }

  flush(): string {
    const rest = this.buffer;
    this.buffer = '';
    // An unterminated marker at the very end (truncated output) is dropped rather than shown.
    const dangling = rest.startsWith('[[') && couldBeMarker(rest.slice(2));
    return this.emit(dangling ? '' : rest);
  }

  private emit(text: string) {
    if (!this.started) {
      text = text.replace(/^\s+/, '');
      if (text) this.started = true;
    }
    return text;
  }

  status(): GroundingStatus | null {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const status = STATUS_MARKERS[this.markers[i].toUpperCase()];
      if (status) return status;
    }
    return null;
  }

  followUps(): string[] {
    const marker = [...this.markers].reverse().find((m) => /^FOLLOW[-_ ]?UPS?\s*:/i.test(m));
    if (!marker) return [];
    return marker
      .replace(/^FOLLOW[-_ ]?UPS?\s*:/i, '')
      .split('|')
      .map((q) => q.trim().replace(/^["'\d.)\s-]+/, '').replace(/["']$/, '').trim())
      .filter((q) => q.length >= 4 && q.length <= 140)
      .slice(0, 3);
  }
}

/** Applies `fn` to prose only — fenced and inline code are left untouched (`[s1, s2]` may be a Python list). */
function outsideCode(text: string, fn: (prose: string) => string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join('');
}

/** Normalises citation variants ("[S1, S3]", "[S 2]", "[S1; S2]") to "[S1][S3]". */
export function normalizeCitations(text: string): string {
  return outsideCode(text, (prose) =>
    prose.replace(/\[\s*((?:S\s?\d{1,2}\s*[,;]?\s*)+)\]/g, (_m, inner: string) =>
      inner
        .split(/[,;]/)
        .map((part) => part.replace(/\s+/g, ''))
        .filter(Boolean)
        .map((ref) => `[${ref}]`)
        .join(''),
    ),
  );
}

export interface CitationResult {
  content: string;
  citedRefs: string[];
  invalidRefs: string[];
}

/** Removes citations to sources that were never provided (a fabricated [S9] must not reach the learner). */
export function validateCitations(text: string, validRefs: Set<string>): CitationResult {
  const cited = new Set<string>();
  const invalid = new Set<string>();
  const content = outsideCode(normalizeCitations(text), (prose) => {
    const cleaned = prose.replace(/\[(S\d{1,2})\]/g, (match, ref: string) => {
      if (validRefs.has(ref)) {
        cited.add(ref);
        return match;
      }
      invalid.add(ref);
      return '\u0000';
    });
    // Tidy the gap a removed citation leaves ("word [S9]." → "word.").
    return cleaned.replace(/[ \t]*\u0000+([ \t]*)/g, (_m, after: string) => after);
  });
  return {
    content: content.trim(),
    citedRefs: [...cited].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    invalidRefs: [...invalid],
  };
}

/** Old answers are replayed as history without their [S#] refs — those ids belonged to an earlier source list. */
export const stripCitations = (text: string) => text.replace(/\s?\[S\d{1,2}\]/g, '');

/**
 * Final grounding verdict: the model's self-report, cross-checked with the evidence actually cited.
 * A "grounded" answer without a single valid citation is downgraded — it is not verifiable.
 */
export function resolveGrounding(input: {
  route: 'grounded' | 'general' | 'chat';
  reported: GroundingStatus | null;
  citedCount: number;
}): { status: GroundingStatus; flags: string[] } {
  const flags: string[] = [];
  if (input.route === 'general') return { status: 'general', flags };
  if (input.route === 'chat') return { status: 'conversational', flags };
  let status = input.reported;
  if (!status || status === 'general' || status === 'conversational') {
    if (!input.reported) flags.push('missing_status_marker');
    status = input.citedCount > 0 ? 'grounded' : 'partial';
  }
  if (status === 'grounded' && input.citedCount === 0) {
    flags.push('uncited_answer');
    status = 'partial';
  }
  return { status, flags };
}
