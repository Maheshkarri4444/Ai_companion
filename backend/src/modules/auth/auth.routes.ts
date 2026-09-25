import { Router } from 'express';
import { config } from '../../config/env';
import { handler, publicHandler } from '../../lib/handler';
import { authenticate } from '../../middleware/authenticate';
import { authRateLimit } from '../../middleware/rateLimits';
import type { IUser } from '../../models/user.model';
import { toUserDto } from '../serializers';
import { loginBody, registerBody } from './auth.schemas';
import { getUserById, loginWithPassword, registerUser } from './auth.service';
import { clearSessionCookieOptions, sessionCookieOptions, signSessionToken } from './session';

export const authRouter = Router();

function startSession(res: import('express').Response, user: IUser) {
  const token = signSessionToken({ id: user._id.toString(), role: user.role, tokenVersion: user.tokenVersion });
  res.cookie(config.COOKIE_NAME, token, sessionCookieOptions());
}

authRouter.post(
  '/register',
  authRateLimit,
  publicHandler({ body: registerBody }, async ({ body, res }) => {
    const user = await registerUser(body);
    startSession(res, user);
    res.status(201);
    return { user: toUserDto(user) };
  }),
);

authRouter.post(
  '/login',
  authRateLimit,
  publicHandler({ body: loginBody }, async ({ body, res }) => {
    const user = await loginWithPassword(body.email, body.password);
    startSession(res, user);
    return { user: toUserDto(user) };
  }),
);

authRouter.post(
  '/logout',
  publicHandler({}, ({ res }) => {
    res.clearCookie(config.COOKIE_NAME, clearSessionCookieOptions());
    return undefined;
  }),
);

authRouter.get(
  '/me',
  authenticate,
  handler({}, async ({ auth }) => ({ user: toUserDto(await getUserById(auth.userId)) })),
);
