import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { ai, type CallMeta } from '../../ai';
import { OCR_PROMPT } from '../../ai/prompts/knowledge';

const BATCH = 4;
export const MAX_OCR_PAGES = 40;
/** Pages with less extractable text than this are treated as scanned/image-only. */
export const OCR_THRESHOLD_CHARS = 40;

const OcrResult = z.object({
  pages: z.array(z.object({ page: z.number().int(), text: z.string() })),
});

/**
 * Document understanding for scanned or image-heavy pages: the pages are cut into small PDFs (no image
 * rendering needed) and transcribed by the light model, including tables and figure descriptions.
 */
export async function ocrPages(
  pdfBuffer: Buffer,
  pageNumbers: number[],
  options: { meta: CallMeta; signal?: AbortSignal; onBatch?: (done: number, total: number) => Promise<void> },
): Promise<Map<number, string>> {
  const results = new Map<number, string>();
  if (pageNumbers.length === 0) return results;
  const source = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  for (let i = 0; i < pageNumbers.length; i += BATCH) {
    const batch = pageNumbers.slice(i, i + BATCH);
    const subset = await PDFDocument.create();
    const copied = await subset.copyPages(
      source,
      batch.map((n) => n - 1),
    );
    copied.forEach((page) => subset.addPage(page));
    const data = Buffer.from(await subset.save()).toString('base64');

    const { data: parsed } = await ai().structured({
      feature: 'material.ocr',
      tier: 'light',
      promptVersion: OCR_PROMPT.version,
      system: OCR_PROMPT.system,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'application/pdf', data } }, { text: OCR_PROMPT.build(batch.length) }],
        },
      ],
      schema: OcrResult,
      meta: options.meta,
      signal: options.signal,
      timeoutMs: 120_000,
      inputPreview: `OCR pages ${batch.join(', ')}`,
    });

    for (const entry of parsed.pages) {
      const original = batch[entry.page - 1];
      if (original !== undefined) results.set(original, entry.text.trim());
    }
    await options.onBatch?.(Math.min(i + BATCH, pageNumbers.length), pageNumbers.length);
  }
  return results;
}
