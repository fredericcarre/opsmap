import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { User } from '../types/index.js';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  name: string | null;
  iat: number;
  exp: number;
}

export function generateToken(user: User): string {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    name: user.name,
  };

  return jwt.sign(payload, config.jwt.secret as jwt.Secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
}

export function decodeToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
}
