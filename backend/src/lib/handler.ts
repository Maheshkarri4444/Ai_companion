import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { AuthInfo } from '../middleware/authenticate';
import { AppError } from './errors';
import { formatZodIssues } from './validation';

type Schemas = { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
type Parsed<T, Fallback> = T extends z.ZodType ? z.output<T> : Fallback;

export type HandlerInput<S extends Schemas> = {
  params: Parsed<S['params'], Record<string, string>>;
  query: Parsed<S['query'], Record<string, unknown>>;
  body: Parsed<S['body'], unknown>;
  req: Request;
  res: Response;
};

function parsePart(schema: z.ZodType | undefined, value: unknown, where: string): unknown {
  if (!schema) return value;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw AppError.badRequest(`Invalid request ${where}`, formatZodIssues(result.error));
  }
  return result.data;
}

function build<S extends Schemas, A>(
  schemas: S,
  resolveAuth: (req: Request) => A,
  fn: (input: HandlerInput<S> & { auth: A }) => unknown,
): RequestHandler {
  return async (req, res) => {
    const auth = resolveAuth(req);
    const input = {
      params: parsePart(schemas.params, req.params, 'path'),
      query: parsePart(schemas.query, req.query, 'query'),
      body: parsePart(schemas.body, req.body, 'body'),
      req,
      res,
      auth,
    } as HandlerInput<S> & { auth: A };

    const result = await fn(input);
    if (res.headersSent) return;
    if (result === undefined) {
      res.status(204).end();
      return;
    }
    res.json(result);
  };
}

function requireAuth(req: Request): AuthInfo {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}

/**
 * Typed route handler for authenticated routes: validates params/query/body with zod (400 on failure),
 * exposes the caller's identity, and serialises the return value as JSON (`undefined` → 204).
 * Handlers stay thin: HTTP translation only, business rules live in services.
 */
export function handler<S extends Schemas>(schemas: S, fn: (input: HandlerInput<S> & { auth: AuthInfo }) => unknown) {
  return build(schemas, requireAuth, fn);
}

export function publicHandler<S extends Schemas>(
  schemas: S,
  fn: (input: HandlerInput<S> & { auth: AuthInfo | undefined }) => unknown,
) {
  return build(schemas, (req) => req.auth, fn);
}
