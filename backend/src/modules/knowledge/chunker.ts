export interface ChunkSourcePage {
  pageNumber: number;
  text: string;
  sectionTitle: string | null;
}

export interface TextChunk {
  index: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
}

export interface ChunkOptions {
  target: number;
  max: number;
  min: number;
  overlap: number;
}

const DEFAULTS: ChunkOptions = { target: 1100, max: 1600, min: 300, overlap: 160 };
const LIST_ITEM = /^([-•*▪◦]|\d+[.)]|[a-z][.)])\s/;

/**
 * Splits a page into sentence-level units. Wrapped PDF lines are re-joined; list items, headings and
 * table rows stay separate; oversized runs are split on word boundaries.
 */
export function pageUnits(text: string, max = DEFAULTS.max): string[] {
  const units: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const lines = paragraph.split('\n').filter((l) => l.trim());
    let current = '';
    const pushCurrent = () => {
      if (current.trim()) units.push(...splitSentences(current.trim()));
      current = '';
    };
    for (const line of lines) {
      const standalone = LIST_ITEM.test(line) || line.startsWith('|') || line.startsWith('[Figure]') || current.endsWith(':');
      if (standalone) {
        pushCurrent();
        current = line;
        if (line.startsWith('|') || line.startsWith('[Figure]')) pushCurrent();
      } else {
        current = current ? `${current} ${line}` : line;
      }
    }
    pushCurrent();
  }
  return units.flatMap((unit) => hardSplit(unit, max));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hardSplit(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit];
  const out: string[] = [];
  let current = '';
  for (const word of unit.split(/\s+/)) {
    if (current.length + word.length + 1 > max && current) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Last whole sentences of a chunk, up to `overlap` characters, carried into the next chunk for context. */
function tail(text: string, overlap: number): string {
  const sentences = splitSentences(text);
  let out = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = out ? `${sentences[i]} ${out}` : sentences[i];
    if (candidate.length > overlap) break;
    out = candidate;
  }
  return out;
}

/**
 * Page-aware chunking. Chunks stay within a section when possible, prefer to end at page boundaries (so
 * citations stay precise), and carry a small sentence-aligned overlap. Deterministic for a given input,
 * which keeps reprocessing idempotent.
 */
export function chunkPages(pages: ChunkSourcePage[], options: Partial<ChunkOptions> = {}): TextChunk[] {
  const opts = { ...DEFAULTS, ...options };
  const chunks: TextChunk[] = [];
  let buffer: { text: string; pageStart: number; pageEnd: number; section: string | null } | null = null;

  const flush = (carryOverlap: boolean) => {
    if (!buffer || !buffer.text.trim()) {
      buffer = null;
      return;
    }
    chunks.push({ index: chunks.length, pageStart: buffer.pageStart, pageEnd: buffer.pageEnd, sectionTitle: buffer.section, text: buffer.text.trim() });
    const overlap = carryOverlap ? tail(buffer.text, opts.overlap) : '';
    buffer = overlap ? { text: overlap, pageStart: buffer.pageEnd, pageEnd: buffer.pageEnd, section: buffer.section } : null;
  };

  for (const page of pages) {
    const units = pageUnits(page.text, opts.max);
    if (units.length === 0) continue;
    if (buffer && page.sectionTitle !== buffer.section && buffer.text.length >= opts.min) flush(false);
    for (const unit of units) {
      if (!buffer) buffer = { text: '', pageStart: page.pageNumber, pageEnd: page.pageNumber, section: page.sectionTitle };
      if (buffer.text.length + unit.length + 1 > opts.target && buffer.text.length >= opts.min) {
        flush(true);
        if (!buffer) buffer = { text: '', pageStart: page.pageNumber, pageEnd: page.pageNumber, section: page.sectionTitle };
      }
      if (!buffer.text) buffer.pageStart = page.pageNumber;
      buffer.text = buffer.text ? `${buffer.text} ${unit}` : unit;
      buffer.pageEnd = page.pageNumber;
      buffer.section = page.sectionTitle ?? buffer.section;
    }
    // Close substantial chunks at the page boundary; small remainders merge with the next page.
    if (buffer && buffer.text.length >= opts.target * 0.6) flush(false);
  }
  flush(false);
  return chunks;
}
