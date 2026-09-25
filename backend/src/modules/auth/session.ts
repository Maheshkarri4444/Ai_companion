import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { isObjectIdString } from '../../lib/validation';
import type { Role } from '../../models/user.model';

export interface SessionPayload {
  sub: string;
  role: Role;
  tv: number;
}

const ttlSeconds = () => config.SESSION_TTL_DAYS * 24 * 60 * 60;

export function signSessionToken(user: { id: string; role: Role; tokenVersion: number }): string {
  return jwt.sign({ role: user.role, tv: user.tokenVersion }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: ttlSeconds(),
    algorithm: 'HS256',
  });
}

/** Returns null for any invalid, expired or malformed token (callers answer 401). */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || !isObjectIdString(payload.sub)) return null;
    const role = payload.role === 'admin' ? 'admin' : 'user';
    const tv = typeof payload.tv === 'number' ? payload.tv : -1;
    return { sub: payload.sub, role, tv };
  } catch {
    return null;
  }
}

/** httpOnly: unreadable by page scripts. SameSite=Lax: not sent on cross-site subrequests. */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds() * 1000,
  };
}

export function clearSessionCookieOptions(): CookieOptions {
  const { maxAge: _ignored, ...rest } = sessionCookieOptions();
  return rest;
}
