import mongoose from 'mongoose';
import { logger } from './logger';

mongoose.set('strictQuery', true);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connect with bounded retries so a slow Atlas start or a brief network blip doesn't kill the boot. */
export async function connectDatabase(uri: string, dbName: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 });
      logger.info({ dbName }, 'MongoDB connected');
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      const delay = 1_000 * 2 ** (attempt - 1);
      logger.warn({ err, attempt, retryInMs: delay }, 'MongoDB connection failed; retrying');
      await sleep(delay);
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function getDb() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected');
  return db;
}

/** Round-trip latency to the primary, or null when unreachable. */
export async function pingDatabase(): Promise<number | null> {
  try {
    const start = performance.now();
    await getDb().command({ ping: 1 });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  }
}
