import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '../models/user.model';

/**
 * Per-request context, available anywhere down the async call chain without threading it through
 * every function. Read by the logger, the activity recorder and (later) the AI gateway and job enqueue.
 */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userId?: string;
  role?: Role;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}
