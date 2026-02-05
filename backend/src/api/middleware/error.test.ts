import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';

vi.mock('../../config/index.js', () => ({
  config: {
    logging: { level: 'silent' },
    nodeEnv: 'test',
  },
}));

vi.mock('../../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../db/repositories/index.js', () => ({
  usersRepository: {},
}));

import { ApiError, errorHandler, notFoundHandler } from './error.js';
import { AuthError } from '../../auth/service.js';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    _json: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      return res;
    },
  };
  return res;
}

function createMockReq(overrides: Record<string, unknown> = {}) {
  return {
    path: '/test',
    method: 'GET',
    ...overrides,
  } as any;
}

describe('ApiError', () => {
  describe('constructor', () => {
    it('should create an error with statusCode, code, and message', () => {
      const err = new ApiError(400, 'BAD_REQUEST', 'Invalid input');

      expect(err).toBeInstanceOf(Error);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toBe('Invalid input');
      expect(err.name).toBe('ApiError');
    });

    it('should support optional details', () => {
      const details = { field: 'email' };
      const err = new ApiError(400, 'BAD_REQUEST', 'Invalid input', details);

      expect(err.details).toEqual({ field: 'email' });
    });
  });

  describe('static factory methods', () => {
    it('badRequest should create a 400 error', () => {
      const err = ApiError.badRequest('Invalid input');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BAD_REQUEST');
      expect(err.message).toBe('Invalid input');
    });

    it('badRequest should accept custom code and details', () => {
      const err = ApiError.badRequest('Bad', 'CUSTOM_CODE', { key: 'val' });
      expect(err.code).toBe('CUSTOM_CODE');
      expect(err.details).toEqual({ key: 'val' });
    });

    it('unauthorized should create a 401 error', () => {
      const err = ApiError.unauthorized();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe('Unauthorized');
    });

    it('unauthorized should accept custom message and code', () => {
      const err = ApiError.unauthorized('Not allowed', 'CUSTOM');
      expect(err.message).toBe('Not allowed');
      expect(err.code).toBe('CUSTOM');
    });

    it('forbidden should create a 403 error', () => {
      const err = ApiError.forbidden();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('notFound should create a 404 error', () => {
      const err = ApiError.notFound();
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    });

    it('conflict should create a 409 error', () => {
      const err = ApiError.conflict('Already exists');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('Already exists');
    });

    it('internal should create a 500 error', () => {
      const err = ApiError.internal();
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.message).toBe('Internal server error');
    });

    it('internal should accept custom message', () => {
      const err = ApiError.internal('Something broke');
      expect(err.message).toBe('Something broke');
    });
  });
});

describe('errorHandler', () => {
  let req: any;
  let res: any;
  const next = vi.fn();

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next.mockClear();
  });

  it('should handle ZodError with 400 status', () => {
    const schema = z.object({ email: z.string().email() });
    let zodError: ZodError;
    try {
      schema.parse({ email: 'invalid' });
    } catch (e) {
      zodError = e as ZodError;
    }

    errorHandler(zodError!, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res._json.code).toBe('VALIDATION_ERROR');
    expect(res._json.message).toBe('Invalid request data');
    expect(res._json.details.errors).toBeInstanceOf(Array);
    expect(res._json.details.errors[0]).toHaveProperty('path');
    expect(res._json.details.errors[0]).toHaveProperty('message');
  });

  it('should handle AuthError with 401 status', () => {
    const err = new AuthError('Bad creds', 'INVALID_CREDENTIALS');

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res._json.code).toBe('INVALID_CREDENTIALS');
    expect(res._json.message).toBe('Bad creds');
  });

  it('should handle ApiError with correct status', () => {
    const err = ApiError.forbidden('No access');

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('FORBIDDEN');
    expect(res._json.message).toBe('No access');
  });

  it('should handle ApiError with details', () => {
    const err = ApiError.badRequest('Invalid', 'BAD', { field: 'name' });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res._json.details).toEqual({ field: 'name' });
  });

  it('should handle PostgreSQL unique constraint (code 23505)', () => {
    const err = new Error('duplicate key') as any;
    err.code = '23505';

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res._json.code).toBe('DUPLICATE_ENTRY');
  });

  it('should handle unknown errors with 500 status', () => {
    const err = new Error('Something unexpected');

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res._json.code).toBe('INTERNAL_ERROR');
    expect(res._json.message).toBe('An unexpected error occurred');
  });
});

describe('notFoundHandler', () => {
  it('should return 404 with route info', () => {
    const req = createMockReq({ method: 'POST', path: '/api/v1/unknown' });
    const res = createMockRes();

    notFoundHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._json.code).toBe('NOT_FOUND');
    expect(res._json.message).toContain('POST');
    expect(res._json.message).toContain('/api/v1/unknown');
  });
});
