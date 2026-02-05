import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware, requireOrgMembership } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import {
  organizationsRepository,
  workspacesRepository,
  usersRepository,
  auditRepository,
} from '../../db/repositories/index.js';
import { createChildLogger } from '../../config/logger.js';

const logger = createChildLogger('organizations-routes');
const router = Router();

const createOrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  settings: z.record(z.unknown()).optional(),
});

const updateOrgSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settings: z.record(z.unknown()).optional(),
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
});

// List user's organizations
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgs = await organizationsRepository.findUserOrganizations(req.user!.id);
    res.json({ data: orgs });
  } catch (error) {
    next(error);
  }
});

// Get single organization
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = await organizationsRepository.findById(req.params.id);
    if (!org) {
      throw ApiError.notFound('Organization not found');
    }

    // Check membership
    const membership = await organizationsRepository.findMembership(req.params.id, req.user!.id);
    if (!membership) {
      throw ApiError.forbidden('Not a member of this organization');
    }

    res.json({
      ...org,
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Create organization
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createOrgSchema.parse(req.body);

    // Check slug uniqueness
    const existing = await organizationsRepository.findBySlug(body.slug);
    if (existing) {
      throw ApiError.conflict('Organization with this slug already exists');
    }

    const org = await organizationsRepository.create(body, req.user!.id);

    // Create default workspace
    await workspacesRepository.create({
      organizationId: org.id,
      name: 'Default',
      slug: 'default',
      description: 'Default workspace',
    });

    await auditRepository.create({
      action: 'organization.create',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'organization',
      targetId: org.id,
      details: { name: org.name },
      organizationId: org.id,
    });

    res.status(201).json(org);
  } catch (error) {
    next(error);
  }
});

// Update organization
router.put(
  '/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check admin access
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw ApiError.forbidden('Admin access required');
      }

      const body = updateOrgSchema.parse(req.body);
      const updated = await organizationsRepository.update(req.params.id, body);

      if (!updated) {
        throw ApiError.notFound('Organization not found');
      }

      await auditRepository.create({
        action: 'organization.update',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'organization',
        targetId: req.params.id,
        details: { changes: body },
        organizationId: req.params.id,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Delete organization
router.delete(
  '/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only owner can delete
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership || membership.role !== 'owner') {
        throw ApiError.forbidden('Only the owner can delete the organization');
      }

      const org = await organizationsRepository.findById(req.params.id);
      await organizationsRepository.deleteOrg(req.params.id);

      await auditRepository.create({
        action: 'organization.delete',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'organization',
        targetId: req.params.id,
        details: { name: org?.name },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// List organization members
router.get(
  '/:id/members',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check membership
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership) {
        throw ApiError.forbidden('Not a member of this organization');
      }

      const members = await organizationsRepository.findMembers(req.params.id);

      // Load user details
      const membersWithDetails = await Promise.all(
        members.map(async (m) => {
          const user = await usersRepository.findById(m.userId);
          return {
            ...m,
            user: user ? {
              id: user.id,
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
            } : null,
          };
        })
      );

      res.json({ data: membersWithDetails });
    } catch (error) {
      next(error);
    }
  }
);

// Add member to organization
router.post(
  '/:id/members',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check admin access
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw ApiError.forbidden('Admin access required');
      }

      const body = z.object({
        email: z.string().email(),
        role: z.enum(['admin', 'member']).default('member'),
      }).parse(req.body);

      const user = await usersRepository.findByEmail(body.email);
      if (!user) {
        throw ApiError.notFound('User not found');
      }

      // Check if already member
      const existingMembership = await organizationsRepository.findMembership(
        req.params.id,
        user.id
      );
      if (existingMembership) {
        throw ApiError.conflict('User is already a member');
      }

      const newMember = await organizationsRepository.addMember(
        req.params.id,
        user.id,
        body.role
      );

      await auditRepository.create({
        action: 'organization.add_member',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'organization',
        targetId: req.params.id,
        details: { addedUser: user.email, role: body.role },
        organizationId: req.params.id,
      });

      res.status(201).json({
        ...newMember,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update member role
router.put(
  '/:id/members/:userId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only owner can change roles
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership || membership.role !== 'owner') {
        throw ApiError.forbidden('Only the owner can change member roles');
      }

      const body = z.object({
        role: z.enum(['owner', 'admin', 'member']),
      }).parse(req.body);

      const updated = await organizationsRepository.updateMemberRole(
        req.params.id,
        req.params.userId,
        body.role
      );

      if (!updated) {
        throw ApiError.notFound('Member not found');
      }

      await auditRepository.create({
        action: 'organization.update_member_role',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'organization',
        targetId: req.params.id,
        details: { userId: req.params.userId, newRole: body.role },
        organizationId: req.params.id,
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Remove member
router.delete(
  '/:id/members/:userId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check admin access
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        throw ApiError.forbidden('Admin access required');
      }

      // Can't remove owner
      const targetMembership = await organizationsRepository.findMembership(
        req.params.id,
        req.params.userId
      );
      if (targetMembership?.role === 'owner') {
        throw ApiError.forbidden('Cannot remove the owner');
      }

      const removed = await organizationsRepository.removeMember(
        req.params.id,
        req.params.userId
      );

      if (!removed) {
        throw ApiError.notFound('Member not found');
      }

      await auditRepository.create({
        action: 'organization.remove_member',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'organization',
        targetId: req.params.id,
        details: { removedUserId: req.params.userId },
        organizationId: req.params.id,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// List workspaces
router.get(
  '/:id/workspaces',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check membership
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership) {
        throw ApiError.forbidden('Not a member of this organization');
      }

      const workspaces = await workspacesRepository.findByOrganization(req.params.id);
      res.json({ data: workspaces });
    } catch (error) {
      next(error);
    }
  }
);

// Create workspace
router.post(
  '/:id/workspaces',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check membership
      const membership = await organizationsRepository.findMembership(
        req.params.id,
        req.user!.id
      );
      if (!membership) {
        throw ApiError.forbidden('Not a member of this organization');
      }

      const body = createWorkspaceSchema.parse(req.body);

      // Check slug uniqueness
      const existing = await workspacesRepository.findBySlug(req.params.id, body.slug);
      if (existing) {
        throw ApiError.conflict('Workspace with this slug already exists');
      }

      const workspace = await workspacesRepository.create({
        organizationId: req.params.id,
        ...body,
      });

      await auditRepository.create({
        action: 'workspace.create',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'workspace',
        targetId: workspace.id,
        details: { name: workspace.name },
        organizationId: req.params.id,
      });

      res.status(201).json(workspace);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
