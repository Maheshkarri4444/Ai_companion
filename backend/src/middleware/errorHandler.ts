import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { config } from '../config/env';
import { getContext } from '../lib/context';
import { AppError, isDuplicateKeyError } from '../lib/errors';
import { logger } from '../lib/logger';

const MONGO_UNAVAILABLE = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
]);

function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(413, 'FILE_TOO_LARGE', `The file exceeds the ${config.MAX_UPLOAD_MB} MB limit.`);
    }
    return AppError.badRequest(err.message, undefined, 'INVALID_UPLOAD');
  }

  if (err instanceof mongoose.Error.CastError) {
    return AppError.badRequest('Invalid identifier', [{ path: err.path, message: 'Invalid id' }]);
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return AppError.badRequest('Validation failed', details);
  }
  if (isDuplicateKeyError(err)) {
    return AppError.conflict('CONFLICT', 'A resource with the same unique value already exists.');
  }

  const e = err as { type?: string; name?: string; message?: string };
  if (e?.type === 'entity.parse.failed') return AppError.badRequest('Malformed JSON body', undefined, 'INVALID_JSON');
  if (e?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  if ((e?.name && MONGO_UNAVAILABLE.has(e.name)) || e?.message?.includes('buffering timed out')) {
    return new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The database is temporarily unavailable. Please retry.');
  }

  return new AppError(
    500,
    'INTERNAL_ERROR',
    config.isProduction ? 'Something went wrong on our side.' : (e?.message ?? 'Unknown error'),
  );
}

export const notFoundHandler: RequestHandler = (req) => {
  throw new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appError = normalizeError(err);
  if (appError.status >= 500) logger.error({ err }, 'Request failed');
  else logger.debug({ code: appError.code, status: appError.status }, appError.message);

  if (res.headersSent) {
    // A stream was already under way; the only safe option is to terminate the response.
    res.destroy();
    return;
  }
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details ?? null,
      requestId: getContext()?.requestId ?? null,
    },
  });
};
