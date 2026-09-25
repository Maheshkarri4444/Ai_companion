/**
 * The only error type services should throw deliberately. The central error handler turns it into
 * `{ error: { code, message, details, requestId } }` with the given HTTP status.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown, code = 'VALIDATION_ERROR') {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  /** Also used for resources owned by someone else, so ids cannot be probed for existence. */
  static notFound(resource = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${resource} not found`);
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(409, code, message, details);
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}
