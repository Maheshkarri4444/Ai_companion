import { ai } from '../../ai';
import { AIError } from '../../ai/errors';
import { JobError } from '../../jobs/queue';
import { registerJobHandler, type JobContext } from '../../jobs/registry';
import { estimateTokens } from '../../lib/text';
import { Chunk, MaterialPage } from '../../models/knowledge.model';
import { Material, type IMaterial } from '../../models/material.model';
import { Project } from '../../models/project.model';
import { storage } from '../../storage/storage';
import { recordEvent } from '../activity/activity.service';
import { touchActivity } from '../workspace';
import { chunkPages } from './chunker';
import { extractConcepts, linkChunksToConcepts, mergeProjectConcepts } from './concepts';
import { extractPdfText } from './extract';
import { looksLikeInjection } from './injection';
import { MAX_OCR_PAGES, OCR_THRESHOLD_CHARS, ocrPages } from './ocr';

type Stage = 'extract' | 'ocr' | 'chunk' | 'embed' | 'concepts';

/** Learner-facing explanations for permanent failures. */
const FRIENDLY: Record<string, string> = {
  PDF_ENCRYPTED: 'This PDF is password-protected. Remove the password and upload it again.',
  PDF_CORRUPT: "This file couldn't be read as a PDF. Try exporting it again and re-uploading.",
  TOO_MANY_PAGES: 'This PDF is too long to process. Split it into parts of up to 300 pages.',
  NO_EXTRACTABLE_TEXT: 'No readable text was found in this PDF, even with OCR.',
  FILE_MISSING: 'The stored file is missing. Please upload it again.',
};

function failureFor(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof JobError) return { code: err.code, message: FRIENDLY[err.code] ?? err.message, retryable: err.retryable };
  if (err instanceof AIError) {
    return {
      code: `AI_${err.kind.toUpperCase()}`,
      message: 'The AI service was unavailable while processing this material. You can retry.',
      retryable: err.retryable,
    };
  }
  return { code: 'PROCESSING_ERROR', message: 'Processing failed unexpectedly. You can retry.', retryable: true };
}

/**
 * `material.process`: extract → OCR (scanned pages) → chunk → embed → concepts → ready.
 * Stages are checkpointed on the material, so a retry resumes where it stopped instead of repeating
 * completed (and paid) AI work. Every write is keyed by material and replaceable, so reruns are idempotent.
 */
async function processMaterial({ job, signal, progress }: JobContext) {
  const { materialId, version } = job.payload as { materialId: string; version: number };
  const material = await Material.findById(materialId).lean();
  if (!material) return { skipped: 'material-deleted' };
  if ((material.processing?.version ?? 1) !== version) return { skipped: 'superseded-by-newer-version' };
  if (material.status === 'ready') return { skipped: 'already-ready' };
  const project = await Project.findOne({ _id: material.projectId, ownerId: material.ownerId }).lean();
  if (!project) return { skipped: 'project-deleted' };

  const ids = { _id: material._id, ownerId: material.ownerId };
  const meta = { ownerId: material.ownerId.toString(), projectId: material.projectId.toString(), jobId: job._id.toString() };
  const done = new Set<string>(material.processing?.completedStages ?? []);
  const started = Date.now();

  const setStage = async (stage: string, pct: number) => {
    await Promise.all([
      Material.updateOne(ids, { $set: { 'processing.stage': stage, 'processing.progress': Math.round(pct) } }),
      progress(stage, pct),
    ]);
  };
  const complete = async (stage: Stage) => {
    done.add(stage);
    await Material.updateOne(ids, { $addToSet: { 'processing.completedStages': stage } });
  };
  const ensureExists = async () => {
    if (!(await Material.exists({ _id: material._id }))) throw new JobError('CANCELLED', 'Material was deleted during processing');
  };

  await Material.updateOne(ids, {
    $set: {
      status: 'processing',
      'processing.jobId': job._id,
      'processing.attempts': job.attempts,
      'processing.error': null,
      ...(material.processing?.startedAt ? {} : { 'processing.startedAt': new Date() }),
    },
  });

  try {
    let buffer: Buffer | null = null;
    const file = async () => {
      buffer ??= await storage.read(material.storage.fileId.toString());
      if (!buffer) throw new JobError('FILE_MISSING', 'Stored file not found');
      return buffer;
    };

    // 1. Text extraction
    if (!done.has('extract')) {
      await setStage('extract', 5);
      const { pageCount, pages } = await extractPdfText(await file());
      await MaterialPage.deleteMany({ materialId: material._id });
      await MaterialPage.insertMany(
        pages.map((p) => ({
          ownerId: material.ownerId,
          projectId: material.projectId,
          materialId: material._id,
          pageNumber: p.pageNumber,
          text: p.text,
          method: 'text',
          charCount: p.text.length,
          sectionTitle: p.sectionTitle,
        })),
      );
      await Material.updateOne(ids, { $set: { pageCount } });
      await complete('extract');
    }
    await ensureExists();

    // 2. OCR for scanned / image-only pages
    if (!done.has('ocr')) {
      await setStage('ocr', 20);
      const candidates = await MaterialPage.find({ materialId: material._id, charCount: { $lt: OCR_THRESHOLD_CHARS } }, { pageNumber: 1 })
        .sort({ pageNumber: 1 })
        .limit(MAX_OCR_PAGES)
        .lean();
      if (candidates.length) {
        const transcribed = await ocrPages(
          await file(),
          candidates.map((c) => c.pageNumber),
          { meta, signal, onBatch: (n, total) => setStage('ocr', 20 + (15 * n) / total) },
        );
        for (const [pageNumber, text] of transcribed) {
          await MaterialPage.updateOne({ materialId: material._id, pageNumber }, { $set: { text, method: 'ocr', charCount: text.length } });
        }
        await Material.updateOne(ids, { $set: { 'stats.ocrPageCount': transcribed.size } });
      }
      await complete('ocr');
    }
    await ensureExists();

    const pages = await MaterialPage.find({ materialId: material._id }).sort({ pageNumber: 1 }).lean();
    const totalChars = pages.reduce((n, p) => n + p.charCount, 0);
    if (totalChars < 50) throw new JobError('NO_EXTRACTABLE_TEXT', 'No text found after extraction and OCR');

    // 3. Chunking (re-chunking invalidates embeddings and concept links)
    if (!done.has('chunk')) {
      await setStage('chunk', 36);
      const chunks = chunkPages(pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text, sectionTitle: p.sectionTitle })));
      await Chunk.deleteMany({ materialId: material._id });
      await Chunk.insertMany(
        chunks.map((c) => ({
          ownerId: material.ownerId,
          projectId: material.projectId,
          materialId: material._id,
          index: c.index,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          sectionTitle: c.sectionTitle,
          text: c.text,
          tokenEstimate: estimateTokens(c.text),
          flags: { suspectedInjection: looksLikeInjection(c.text) },
        })),
      );
      done.delete('embed');
      done.delete('concepts');
      await Material.updateOne(ids, { $pull: { 'processing.completedStages': { $in: ['embed', 'concepts'] } } });
      await complete('chunk');
    }
    await ensureExists();

    // 4. Embeddings (only chunks still missing one — resumable)
    if (!done.has('embed')) {
      const pending = await Chunk.find({ materialId: material._id, 'embedding.0': { $exists: false } }, { text: 1, sectionTitle: 1 })
        .sort({ index: 1 })
        .lean();
      const total = await Chunk.countDocuments({ materialId: material._id });
      let completed = total - pending.length;
      for (let i = 0; i < pending.length; i += 50) {
        await setStage('embed', 40 + (35 * completed) / Math.max(total, 1));
        const batch = pending.slice(i, i + 50);
        const vectors = await ai().embed(
          batch.map((c) => (c.sectionTitle ? `${c.sectionTitle}\n${c.text}` : c.text)),
          { feature: 'embed.document', taskType: 'RETRIEVAL_DOCUMENT', title: material.title, meta, signal },
        );
        await Chunk.bulkWrite(batch.map((c, j) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { embedding: vectors[j] } } } })));
        completed += batch.length;
      }
      await complete('embed');
    }
    await ensureExists();

    // 5. Concepts: extract, merge into the Project, link chunks
    if (!done.has('concepts')) {
      await setStage('concepts', 78);
      const extraction = await extractConcepts({
        title: material.title,
        goal: project.learningGoal,
        pageCount: pages.length,
        pages: pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
        meta,
        signal,
      });
      await setStage('concepts', 88);
      await mergeProjectConcepts({
        ownerId: material.ownerId,
        projectId: material.projectId,
        materialId: material._id,
        concepts: extraction.concepts,
        meta,
        signal,
      });
      await linkChunksToConcepts(material.ownerId, material.projectId);
      await Material.updateOne(ids, { $set: { summary: extraction.summary || null, 'stats.conceptCount': extraction.concepts.length } });
      await complete('concepts');
    }

    // Finalise
    const chunkCount = await Chunk.countDocuments({ materialId: material._id });
    const fresh = (await Material.findById(material._id).lean()) as IMaterial | null;
    if (!fresh) return { skipped: 'material-deleted' };
    await Material.updateOne(ids, {
      $set: {
        status: 'ready',
        'processing.stage': 'done',
        'processing.progress': 100,
        'processing.finishedAt': new Date(),
        'processing.error': null,
        'stats.chunkCount': chunkCount,
      },
    });
    await touchActivity({ spaceId: material.spaceId, projectId: material.projectId });
    await recordEvent({
      type: 'material.processed',
      ownerId: material.ownerId,
      actorId: null,
      spaceId: material.spaceId,
      projectId: material.projectId,
      materialId: material._id,
      metadata: {
        materialTitle: fresh.title,
        projectName: project.name,
        pageCount: fresh.pageCount,
        chunkCount,
        conceptCount: fresh.stats?.conceptCount ?? 0,
        ocrPageCount: fresh.stats?.ocrPageCount ?? 0,
        durationMs: Date.now() - started,
      },
      eventKey: `material.processed:${material._id.toString()}:v${version}`,
    });
    return { pageCount: fresh.pageCount, chunkCount, conceptCount: fresh.stats?.conceptCount ?? 0 };
  } catch (err) {
    const failure = failureFor(err);
    if (failure.code === 'CANCELLED') return { skipped: 'material-deleted' };
    const willRetry = failure.retryable && job.attempts < job.maxAttempts;
    await Material.updateOne(ids, {
      $set: willRetry
        ? { status: 'queued', 'processing.stage': 'waiting-to-retry', 'processing.error': { ...failure } }
        : { status: 'failed', 'processing.error': { ...failure }, 'processing.finishedAt': new Date() },
    });
    if (!willRetry) {
      await recordEvent({
        type: 'material.failed',
        ownerId: material.ownerId,
        actorId: null,
        spaceId: material.spaceId,
        projectId: material.projectId,
        materialId: material._id,
        metadata: { materialTitle: material.title, projectName: project.name, code: failure.code },
        eventKey: `material.failed:${material._id.toString()}:v${version}`,
      });
    }
    throw err;
  }
}

export function registerKnowledgeJobs() {
  registerJobHandler('material.process', processMaterial);
}

