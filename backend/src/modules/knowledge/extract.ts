import { extractText, getDocumentProxy } from 'unpdf';
import { JobError } from '../../jobs/queue';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  sectionTitle: string | null;
}

export const MAX_PAGES = 300;
const PARSE_TIMEOUT_MS = 60_000;

const KEYWORD_HEADING = /^(chapter|section|part|unit|module|lecture|lesson|topic|appendix)\b[\s\d.:–-].{0,80}$/i;
const NUMBERED_HEADING = /^(\d+(\.\d+){0,3})\.?\s+[A-Z][^.!?]{2,80}$/;

/** Joins wrapped lines, removes soft hyphenation and noise while keeping paragraph and list structure. */
export function normalizePageText(raw: string): string {
  const lines = raw
    .replace(/\u0000/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim());
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Headings help retrieval (section context) and citations; keep the heuristic conservative. */
export function detectHeading(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);
  for (const line of lines) {
    if (line.length <= 90 && (KEYWORD_HEADING.test(line) || NUMBERED_HEADING.test(line))) return line;
  }
  const first = lines[0];
  if (first && first.length <= 60 && /^[A-Z]/.test(first) && !/[.!?:;,]$/.test(first) && first.split(/\s+/).length <= 8) {
    return first;
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new JobError(code, message, true)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Per-page text via pdf.js. Encrypted / corrupt / oversized files fail permanently with a clear code. */
export async function extractPdfText(buffer: Buffer): Promise<{ pageCount: number; pages: ExtractedPage[] }> {
  let pdf;
  try {
    pdf = await withTimeout(
      getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 }),
      PARSE_TIMEOUT_MS,
      'PDF_TIMEOUT',
      'Opening the PDF timed out.',
    );
  } catch (err) {
    if (err instanceof JobError) throw err;
    const name = (err as Error)?.name ?? '';
    if (name === 'PasswordException') throw new JobError('PDF_ENCRYPTED', 'This PDF is password-protected.');
    throw new JobError('PDF_CORRUPT', 'This file could not be read as a PDF.');
  }
  try {
    if (pdf.numPages > MAX_PAGES) {
      throw new JobError('TOO_MANY_PAGES', `This PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}.`);
    }
    const { text } = await withTimeout(
      extractText(pdf, { mergePages: false }),
      PARSE_TIMEOUT_MS,
      'PDF_TIMEOUT',
      'Extracting text from the PDF timed out.',
    );
    let section: string | null = null;
    const pages = (text as string[]).map((raw, i) => {
      const normalized = normalizePageText(raw ?? '');
      section = detectHeading(normalized) ?? section; // headings carry forward to following pages
      return { pageNumber: i + 1, text: normalized, sectionTitle: section };
    });
    return { pageCount: pdf.numPages, pages };
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}
