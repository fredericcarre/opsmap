import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../db/repositories/index.js', () => ({
  usersRepository: {
    verifyPassword: vi.fn(),
    updateLastLogin: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
  },
}));

import { login, register, refreshToken, AuthError } from './service.js';
import { usersRepository } from '../db/repositories/index.js';
import type { User } from '../types/index.js';

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

describe('AuthError', () => {
  it('should create an error with message and code', () => {
    const err = new AuthError('Invalid credentials', 'INVALID_CREDENTIALS');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthError');
    expect(err.message).toBe('Invalid credentials');
    expect(err.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return user and token on valid credentials', async () => {
    vi.mocked(usersRepository.verifyPassword).mockResolvedValue(mockUser);
    vi.mocked(usersRepository.updateLastLogin).mockResolvedValue(undefined as any);

    const result = await login('test@example.com', 'password123');

    expect(result.user).toEqual(mockUser);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(usersRepository.verifyPassword).toHaveBeenCalledWith('test@example.com', 'password123');
    expect(usersRepository.updateLastLogin).toHaveBeenCalledWith(mockUser.id);
  });

  it('should throw AuthError on invalid credentials', async () => {
    vi.mocked(usersRepository.verifyPassword).mockResolvedValue(null as any);

    await expect(login('test@example.com', 'wrong')).rejects.toThrow(AuthError);
    await expect(login('test@example.com', 'wrong')).rejects.toThrow('Invalid email or password');
  });
});

describe('register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create user and return token', async () => {
    vi.mocked(usersRepository.findByEmail).mockResolvedValue(null as any);
    vi.mocked(usersRepository.create).mockResolvedValue(mockUser);
    vi.mocked(usersRepository.updateLastLogin).mockResolvedValue(undefined as any);

    const result = await register({
      email: 'new@example.com',
      password: 'password123',
      name: 'New User',
    });

    expect(result.user).toEqual(mockUser);
    expect(result.token).toBeDefined();
    expect(usersRepository.create).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
      name: 'New User',
      authProvider: 'local',
    });
  });

  it('should throw AuthError if email already exists', async () => {
    vi.mocked(usersRepository.findByEmail).mockResolvedValue(mockUser);

    await expect(
      register({ email: 'test@example.com', password: 'password123' })
    ).rejects.toThrow(AuthError);
  });
});

describe('refreshToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a new token for existing user', async () => {
    vi.mocked(usersRepository.findById).mockResolvedValue(mockUser);

    const token = await refreshToken('user-123');

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
    expect(usersRepository.findById).toHaveBeenCalledWith('user-123');
  });

  it('should throw AuthError if user not found', async () => {
    vi.mocked(usersRepository.findById).mockResolvedValue(null as any);

    await expect(refreshToken('nonexistent')).rejects.toThrow(AuthError);
    await expect(refreshToken('nonexistent')).rejects.toThrow('User not found');
  });
});
