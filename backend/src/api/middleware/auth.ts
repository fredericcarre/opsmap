import { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../../auth/jwt.js';
import { usersRepository } from '../../db/repositories/index.js';
import { createChildLogger } from '../../config/logger.js';
import type { User } from '../../types/index.js';

const logger = createChildLogger('auth-middleware');

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: User;
      jwtPayload?: JwtPayload;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid authorization header',
    });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    req.jwtPayload = payload;

    // Load full user from database
    const user = await usersRepository.findById(payload.sub);
    if (!user) {
      res.status(401).json({
        code: 'USER_NOT_FOUND',
        message: 'User no longer exists',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    logger.debug({ error }, 'JWT verification failed');
    res.status(401).json({
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token',
    });
  }
}

// Optional auth - sets user if token present but doesn't require it
export async function optionalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    req.jwtPayload = payload;

    const user = await usersRepository.findById(payload.sub);
    if (user) {
      req.user = user;
    }
  } catch {
    // Ignore invalid tokens in optional auth
  }

  next();
}

// Require specific organization membership
export function requireOrgMembership(
  roleLevel: 'owner' | 'admin' | 'member' = 'member'
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    const orgId = req.params.organizationId || req.body?.organizationId;
    if (!orgId) {
      res.status(400).json({
        code: 'MISSING_ORG_ID',
        message: 'Organization ID required',
      });
      return;
    }

    const { organizationsRepository } = await import('../../db/repositories/index.js');
    const membership = await organizationsRepository.findMembership(orgId, req.user.id);

    if (!membership) {
      res.status(403).json({
        code: 'NOT_ORG_MEMBER',
        message: 'Not a member of this organization',
      });
      return;
    }

    const roleLevels = { owner: 3, admin: 2, member: 1 };
    if (roleLevels[membership.role] < roleLevels[roleLevel]) {
      res.status(403).json({
        code: 'INSUFFICIENT_ROLE',
        message: `Requires ${roleLevel} role or higher`,
      });
      return;
    }

    next();
  };
}
