import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../../auth/service.js';
import { authMiddleware } from '../middleware/auth.js';
import { auditRepository } from '../../db/repositories/index.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

// Login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.email, body.password);

    await auditRepository.create({
      action: 'auth.login',
      actorType: 'user',
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorIp: req.ip,
      targetType: 'user',
      targetId: result.user.id,
    });

    res.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        avatarUrl: result.user.avatarUrl,
      },
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
});

// Register
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body);

    await auditRepository.create({
      action: 'auth.register',
      actorType: 'user',
      actorId: result.user.id,
      actorEmail: result.user.email,
      actorIp: req.ip,
      targetType: 'user',
      targetId: result.user.id,
    });

    res.status(201).json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        avatarUrl: result.user.avatarUrl,
      },
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  const user = req.user!;
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  });
});

// Refresh token
router.post('/refresh', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = await authService.refreshToken(req.user!.id);
    res.json({ token });
  } catch (error) {
    next(error);
  }
});

// Logout (client should discard token, this is for audit)
router.post('/logout', authMiddleware, async (req: Request, res: Response) => {
  await auditRepository.create({
    action: 'auth.logout',
    actorType: 'user',
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    actorIp: req.ip,
    targetType: 'user',
    targetId: req.user!.id,
  });

  res.json({ message: 'Logged out' });
});

export default router;
