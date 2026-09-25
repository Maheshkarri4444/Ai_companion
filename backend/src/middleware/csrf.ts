import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (the session cookie is also SameSite=Lax): state-changing requests must carry
 * `X-Requested-With`. A cross-site form cannot set custom headers, and a cross-site fetch would need a
 * CORS preflight that this API never grants to foreign origins.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.get('x-requested-with')) {
    throw AppError.forbidden('Missing X-Requested-With header', 'CSRF_REJECTED');
  }
  next();
};
