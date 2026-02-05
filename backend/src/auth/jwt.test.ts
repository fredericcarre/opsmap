import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../config/index.js', () => ({
  config: {
    jwt: {
      secret: 'test-secret-key-for-unit-tests-min-32-chars',
      expiresIn: '1h',
    },
    logging: { level: 'silent' },
    nodeEnv: 'test',
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { generateToken, verifyToken, decodeToken, type JwtPayload } from './jwt.js';
import type { User } from '../types/index.js';

const SECRET = 'test-secret-key-for-unit-tests-min-32-chars';

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

describe('JWT utilities', () => {
  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const token = generateToken(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should include correct payload fields', () => {
      const token = generateToken(mockUser);
      const decoded = jwt.decode(token) as JwtPayload;

      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.name).toBe(mockUser.name);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should handle user with null name', () => {
      const userWithNullName = { ...mockUser, name: null };
      const token = generateToken(userWithNullName);
      const decoded = jwt.decode(token) as JwtPayload;

      expect(decoded.name).toBeNull();
    });

    it('should set expiration time', () => {
      const token = generateToken(mockUser);
      const decoded = jwt.decode(token) as JwtPayload;

      expect(decoded.exp).toBeGreaterThan(decoded.iat);
      expect(decoded.exp - decoded.iat).toBe(3600);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = generateToken(mockUser);
      const payload = verifyToken(token);

      expect(payload.sub).toBe(mockUser.id);
      expect(payload.email).toBe(mockUser.email);
    });

    it('should throw on invalid token', () => {
      expect(() => verifyToken('invalid-token')).toThrow();
    });

    it('should throw on expired token', () => {
      const token = jwt.sign(
        { sub: 'user-1', email: 'test@test.com', name: 'Test' },
        SECRET,
        { expiresIn: '0s' }
      );
      expect(() => verifyToken(token)).toThrow();
    });

    it('should throw on token signed with wrong secret', () => {
      const token = jwt.sign(
        { sub: 'user-1', email: 'test@test.com', name: 'Test' },
        'wrong-secret-key',
        { expiresIn: '1h' }
      );
      expect(() => verifyToken(token)).toThrow();
    });
  });

  describe('decodeToken', () => {
    it('should decode a valid token without verification', () => {
      const token = generateToken(mockUser);
      const payload = decodeToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.sub).toBe(mockUser.id);
      expect(payload!.email).toBe(mockUser.email);
    });

    it('should return null for non-JWT strings', () => {
      const result = decodeToken('not-a-jwt');
      expect(result).toBeNull();
    });
  });
});
