import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithContext } from '../lib/context';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns a request id (honouring a well-formed inbound `X-Request-Id`) and opens the async context. */
export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.get('x-request-id');
  const requestId = inbound && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  runWithContext({ requestId, ip: req.ip }, () => next());
};
