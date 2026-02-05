import { usersRepository } from '../db/repositories/index.js';
import { generateToken } from './jwt.js';
import { createChildLogger } from '../config/logger.js';
import type { User } from '../types/index.js';

const logger = createChildLogger('auth');

export interface LoginResult {
  user: User;
  token: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
}

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  const user = await usersRepository.verifyPassword(email, password);

  if (!user) {
    logger.warn({ email }, 'Login failed: invalid credentials');
    throw new AuthError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  await usersRepository.updateLastLogin(user.id);

  const token = generateToken(user);

  logger.info({ userId: user.id, email }, 'User logged in');

  return { user, token };
}

export async function register(input: RegisterInput): Promise<LoginResult> {
  // Check if user exists
  const existing = await usersRepository.findByEmail(input.email);
  if (existing) {
    throw new AuthError('Email already registered', 'EMAIL_EXISTS');
  }

  const user = await usersRepository.create({
    email: input.email,
    password: input.password,
    name: input.name,
    authProvider: 'local',
  });

  await usersRepository.updateLastLogin(user.id);

  const token = generateToken(user);

  logger.info({ userId: user.id, email: user.email }, 'User registered');

  return { user, token };
}

export async function refreshToken(userId: string): Promise<string> {
  const user = await usersRepository.findById(userId);

  if (!user) {
    throw new AuthError('User not found', 'USER_NOT_FOUND');
  }

  return generateToken(user);
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
