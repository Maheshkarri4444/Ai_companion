import type { RequestHandler } from 'express';
import { config } from '../config/env';
import { getContext } from '../lib/context';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { User, type Role } from '../models/user.model';
import { verifySessionToken } from '../modules/auth/session';

export interface AuthInfo {
  userId: string;
  role: Role;
}

const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_INVALID = 'Your session has expired. Please sign in again.';

/**
 * Verifies the session cookie and re-checks the user in the database on every request, so disabled
 * accounts and revoked sessions (tokenVersion bump) stop working immediately.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[config.COOKIE_NAME];
  if (typeof token !== 'string' || !token) throw AppError.unauthorized();

  const payload = verifySessionToken(token);
  if (!payload) throw AppError.unauthorized(SESSION_INVALID);

  const user = await User.findById(payload.sub, { role: 1, status: 1, tokenVersion: 1, lastActiveAt: 1 }).lean();
  if (!user || user.status !== 'active' || user.tokenVersion !== payload.tv) {
    throw AppError.unauthorized(SESSION_INVALID);
  }

  req.auth = { userId: user._id.toString(), role: user.role };
  const ctx = getContext();
  if (ctx) {
    ctx.userId = req.auth.userId;
    ctx.role = user.role;
  }

  // Throttled "last seen" tracking for engagement analytics; never blocks the request.
  const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
  if (Date.now() - lastActive > ACTIVITY_TOUCH_INTERVAL_MS) {
    User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } }).catch((err) =>
      logger.warn({ err }, 'Failed to update lastActiveAt'),
    );
  }

  next();
};

export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw AppError.unauthorized();
    if (req.auth.role !== role) throw AppError.forbidden();
    next();
  };
}
