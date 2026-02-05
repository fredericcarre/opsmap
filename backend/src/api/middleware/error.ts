import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createChildLogger } from '../../config/logger.js';
import { AuthError } from '../../auth/service.js';

const logger = createChildLogger('error-handler');

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>): ApiError {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN'): ApiError {
    return new ApiError(403, code, message);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND'): ApiError {
    return new ApiError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT'): ApiError {
    return new ApiError(409, code, message);
  }

  static internal(message = 'Internal server error'): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: {
        errors: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
    return;
  }

  // Auth errors
  if (err instanceof AuthError) {
    res.status(401).json({
      code: err.code,
      message: err.message,
    });
    return;
  }

  // API errors
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }

  // PostgreSQL unique constraint violation
  if ((err as unknown as Record<string, unknown>).code === '23505') {
    res.status(409).json({
      code: 'DUPLICATE_ENTRY',
      message: 'Resource already exists',
    });
    return;
  }

  // Default error
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');

  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });
}
