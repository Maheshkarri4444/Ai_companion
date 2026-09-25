import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config/env';
import { AppError } from '../lib/errors';

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0');

const shared: Partial<Options> = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => !config.RATE_LIMIT_ENABLED,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment and try again.')),
};

/** Brute-force protection for credential endpoints (per client IP). */
export const authRateLimit = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: clientIp,
});

/** Upload quota per user (falls back to IP if ever mounted before authentication). */
export const uploadRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.auth?.userId ?? clientIp(req),
});

/** Tutor messages per user: protects AI spend and the provider quota. */
export const tutorRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.auth?.userId ?? clientIp(req),
  handler: (_req, _res, next) =>
    next(new AppError(429, 'RATE_LIMITED', 'You are sending messages very quickly. Please wait a moment before asking Zoya again.')),
});
