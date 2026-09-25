import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Response } from 'express';
import { AppError } from '../../lib/errors';

const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream']);

/** The PDF header must appear within the first 1024 bytes (ISO 32000-1 §7.5.2). */
function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');
}

/**
 * Client-supplied MIME types and names are untrusted: a file must claim to be a PDF (type + extension)
 * AND carry the PDF signature to be accepted.
 */
export function assertPdf(file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
  if (file.size === 0 || file.buffer.length === 0) {
    throw AppError.badRequest('The uploaded file is empty.', undefined, 'EMPTY_FILE');
  }
  const looksLikePdf = PDF_MIME_TYPES.has(file.mimetype) && /\.pdf$/i.test(file.originalname);
  if (!looksLikePdf || !hasPdfSignature(file.buffer)) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only PDF files are supported.');
  }
}

/** Strip path segments and control characters from a client-provided filename. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'document.pdf';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'document.pdf').slice(0, 255);
}

/** "machine_learning-notes.pdf" → "machine learning-notes" */
export function titleFromFilename(filename: string): string {
  const title = filename
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (title || 'Untitled document').slice(0, 200);
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Streams a stored PDF inline (the browser viewer supports `#page=N` deep links used by citations). */
export async function streamPdf(res: Response, file: { stream: Readable; sizeBytes: number }, filename: string) {
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(file.sizeBytes));
  res.setHeader('Content-Disposition', contentDisposition(filename));
  res.setHeader('Cache-Control', 'private, max-age=300');
  // The API-wide CSP (object-src 'none', …) can stop built-in PDF viewers from rendering. It adds nothing
  // here: the bytes are a verified PDF served as application/pdf with nosniff, never interpreted as HTML.
  res.removeHeader('Content-Security-Policy');
  try {
    await pipeline(file.stream, res);
  } catch (err) {
    // The viewer closing the connection early is normal, not a server error.
    if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
  }
}
