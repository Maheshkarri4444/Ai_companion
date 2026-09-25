import type { AuthInfo } from '../middleware/authenticate';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` once the session cookie has been verified against the database. */
      auth?: AuthInfo;
    }
  }
}

export {};
