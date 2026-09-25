import type { IJob } from '../models/job.model';

export interface JobContext {
  job: IJob;
  /** Aborted when the worker shuts down; long handlers should pass it to I/O and AI calls. */
  signal: AbortSignal;
  progress(stage: string, pct: number): Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

const handlers = new Map<string, JobHandler>();

/** Modules register their workflow handlers here; the worker only claims job types it can run. */
export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}
