import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import { getDb } from '../lib/db';

export interface StoredFile {
  fileId: string;
  sizeBytes: number;
}

export interface FileDownload {
  stream: Readable;
  sizeBytes: number;
}

/**
 * File storage abstraction. GridFS today (no extra service or credentials, works on any host);
 * S3/R2 can be dropped in behind the same interface.
 */
export interface StorageProvider {
  save(input: { buffer: Buffer; filename: string; metadata: Record<string, unknown> }): Promise<StoredFile>;
  open(fileId: string): Promise<FileDownload | null>;
  /** Idempotent: deleting a missing file is not an error. */
  delete(fileId: string): Promise<void>;
  usage(): Promise<{ files: number; totalBytes: number }>;
}

const BUCKET = 'material_files';

class GridFsStorage implements StorageProvider {
  // Created per call: cheap, and never holds a stale handle across reconnects.
  private bucket() {
    return new mongoose.mongo.GridFSBucket(getDb(), { bucketName: BUCKET });
  }

  async save({ buffer, filename, metadata }: { buffer: Buffer; filename: string; metadata: Record<string, unknown> }) {
    const upload = this.bucket().openUploadStream(filename, { metadata });
    await pipeline(Readable.from(buffer), upload);
    return { fileId: upload.id.toString(), sizeBytes: buffer.length };
  }

  async open(fileId: string) {
    const _id = new mongoose.Types.ObjectId(fileId);
    const bucket = this.bucket();
    const [file] = await bucket.find({ _id }).limit(1).toArray();
    if (!file) return null;
    return { stream: bucket.openDownloadStream(_id), sizeBytes: file.length };
  }

  async delete(fileId: string) {
    try {
      await this.bucket().delete(new mongoose.Types.ObjectId(fileId));
    } catch (err) {
      if (!/file not found/i.test((err as Error).message ?? '')) throw err;
    }
  }

  async usage() {
    const [row] = await getDb()
      .collection(`${BUCKET}.files`)
      .aggregate<{ files: number; totalBytes: number }>([
        { $group: { _id: null, files: { $sum: 1 }, totalBytes: { $sum: '$length' } } },
      ])
      .toArray();
    return { files: row?.files ?? 0, totalBytes: row?.totalBytes ?? 0 };
  }
}

export const storage: StorageProvider = new GridFsStorage();
