import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = 'test-secret-key-for-unit-tests-min-32-chars';

vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-secret-key-for-unit-tests-min-32-chars', expiresIn: '1h' },
    logging: { level: 'silent' },
    nodeEnv: 'test',
  },
}));

vi.mock('../../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../db/repositories/index.js', () => ({
  usersRepository: {
    findById: vi.fn(),
  },
  organizationsRepository: {
    findMembership: vi.fn(),
  },
}));

import { authMiddleware, optionalAuthMiddleware, requireOrgMembership } from './auth.js';
import { usersRepository, organizationsRepository } from '../../db/repositories/index.js';
import type { User } from '../../types/index.js';

const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  authProvider: 'local',
  authProviderId: null,
  createdAt: new Date(),
  lastLoginAt: null,
};

function createValidToken() {
  return jwt.sign({ sub: 'user-123', email: 'test@example.com', name: 'Test' }, SECRET, {
    expiresIn: '1h',
  });
}

function createMockReq(headers: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  return { headers, params: {}, body: {}, ...overrides } as any;
}

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

describe('authMiddleware', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if no authorization header', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res._json.code).toBe('UNAUTHORIZED');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if authorization header has wrong scheme', async () => {
    const req = createMockReq({ authorization: 'Basic abc123' });
    const res = createMockRes();

    await authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if token is invalid', async () => {
    const req = createMockReq({ authorization: 'Bearer invalid-token' });
    const res = createMockRes();

    await authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res._json.code).toBe('INVALID_TOKEN');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if user not found in database', async () => {
    const token = createValidToken();
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();
    vi.mocked(usersRepository.findById).mockResolvedValue(null as any);

    await authMiddleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res._json.code).toBe('USER_NOT_FOUND');
    expect(next).not.toHaveBeenCalled();
  });

  it('should set user and call next on valid token', async () => {
    const token = createValidToken();
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();
    vi.mocked(usersRepository.findById).mockResolvedValue(mockUser);

    await authMiddleware(req, res, next);

    expect(req.user).toEqual(mockUser);
    expect(req.jwtPayload).toBeDefined();
    expect(req.jwtPayload.sub).toBe('user-123');
    expect(next).toHaveBeenCalled();
  });
});

describe('optionalAuthMiddleware', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call next without setting user when no auth header', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('should set user when valid token is present', async () => {
    const token = createValidToken();
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();
    vi.mocked(usersRepository.findById).mockResolvedValue(mockUser);

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toEqual(mockUser);
    expect(next).toHaveBeenCalled();
  });

  it('should call next without user when token is invalid', async () => {
    const req = createMockReq({ authorization: 'Bearer invalid-token' });
    const res = createMockRes();

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('should call next without user when user not found', async () => {
    const token = createValidToken();
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();
    vi.mocked(usersRepository.findById).mockResolvedValue(null as any);

    await optionalAuthMiddleware(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('requireOrgMembership', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if no user on request', async () => {
    const middleware = requireOrgMembership();
    const req = createMockReq({}, { user: undefined, params: { organizationId: 'org-1' } });
    const res = createMockRes();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res._json.code).toBe('UNAUTHORIZED');
  });

  it('should return 400 if no organization ID', async () => {
    const middleware = requireOrgMembership();
    const req = createMockReq({}, { user: mockUser, params: {} });
    const res = createMockRes();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res._json.code).toBe('MISSING_ORG_ID');
  });

  it('should return 403 if user is not a member', async () => {
    const middleware = requireOrgMembership();
    const req = createMockReq({}, { user: mockUser, params: { organizationId: 'org-1' } });
    const res = createMockRes();
    vi.mocked(organizationsRepository.findMembership).mockResolvedValue(null as any);

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('NOT_ORG_MEMBER');
  });

  it('should return 403 if role is insufficient', async () => {
    const middleware = requireOrgMembership('admin');
    const req = createMockReq({}, { user: mockUser, params: { organizationId: 'org-1' } });
    const res = createMockRes();
    vi.mocked(organizationsRepository.findMembership).mockResolvedValue({ role: 'member' } as any);

    await middleware(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res._json.code).toBe('INSUFFICIENT_ROLE');
  });

  it('should call next if role is sufficient', async () => {
    const middleware = requireOrgMembership('member');
    const req = createMockReq({}, { user: mockUser, params: { organizationId: 'org-1' } });
    const res = createMockRes();
    vi.mocked(organizationsRepository.findMembership).mockResolvedValue({ role: 'admin' } as any);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should accept owner for any role level', async () => {
    const middleware = requireOrgMembership('admin');
    const req = createMockReq({}, { user: mockUser, params: { organizationId: 'org-1' } });
    const res = createMockRes();
    vi.mocked(organizationsRepository.findMembership).mockResolvedValue({ role: 'owner' } as any);

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
