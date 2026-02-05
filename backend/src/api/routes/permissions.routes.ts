import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { authMiddleware } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import {
  mapsRepository,
  usersRepository,
  permissionsRepository,
  auditRepository,
} from '../../db/repositories/index.js';
const router = Router();

const grantUserPermissionSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  role: z.enum(['viewer', 'operator', 'editor', 'admin', 'restricted_operator']),
  overrides: z.object({
    components: z.record(z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })).optional(),
    actions: z.record(z.record(z.enum(['allow', 'deny']))).optional(),
  }).optional(),
  expiresAt: z.string().datetime().optional(),
});

const grantGroupPermissionSchema = z.object({
  groupId: z.string().uuid(),
  role: z.enum(['viewer', 'operator', 'editor', 'admin', 'restricted_operator']),
  overrides: z.object({
    components: z.record(z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })).optional(),
  }).optional(),
});

const createShareLinkSchema = z.object({
  role: z.enum(['viewer', 'operator', 'editor']),
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().positive().optional(),
  password: z.string().min(4).optional(),
});

// Helper to verify admin access on map
async function checkAdminAccess(userId: string, mapId: string): Promise<void> {
  const result = await permissionsRepository.checkPermission(userId, mapId, 'map:admin');
  if (!result.allowed) {
    // Check if owner
    const map = await mapsRepository.findById(mapId);
    if (!map || map.ownerId !== userId) {
      throw ApiError.forbidden('Admin access required to manage permissions');
    }
  }
}

// Get map permissions
router.get(
  '/maps/:mapId/permissions',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Need at least view access to see permissions
      const viewResult = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        'map:view'
      );
      if (!viewResult.allowed) {
        throw ApiError.forbidden('No access to this map');
      }

      const map = await mapsRepository.findById(req.params.mapId);
      if (!map) {
        throw ApiError.notFound('Map not found');
      }

      const owner = await usersRepository.findById(map.ownerId);
      const userPerms = await permissionsRepository.findMapUserPermissions(req.params.mapId);
      const groupPerms = await permissionsRepository.findMapGroupPermissions(req.params.mapId);
      const shareLinks = await permissionsRepository.findMapShareLinks(req.params.mapId);

      // Load role names
      const roles = await permissionsRepository.listRoles();
      const roleMap = new Map(roles.map((r) => [r.id, r.name]));

      // Load user details
      const userDetails = await Promise.all(
        userPerms.map(async (p) => {
          const user = await usersRepository.findById(p.userId);
          return {
            user: user ? { id: user.id, email: user.email, name: user.name } : null,
            role: roleMap.get(p.roleId),
            overrides: p.permissionOverrides,
            grantedAt: p.grantedAt,
            expiresAt: p.expiresAt,
          };
        })
      );

      res.json({
        owner: owner ? {
          id: owner.id,
          email: owner.email,
          name: owner.name,
        } : null,
        users: userDetails.filter((u) => u.user),
        groups: groupPerms.map((p) => ({
          groupId: p.groupId,
          role: roleMap.get(p.roleId),
          overrides: p.permissionOverrides,
          grantedAt: p.grantedAt,
        })),
        shareLinks: shareLinks.map((l) => ({
          id: l.id,
          token: l.token.slice(0, 8) + '...', // Partial token for display
          role: roleMap.get(l.roleId),
          createdAt: l.createdAt,
          expiresAt: l.expiresAt,
          maxUses: l.maxUses,
          useCount: l.useCount,
          isActive: l.isActive,
          hasPassword: !!l.passwordHash,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Grant user permission
router.post(
  '/maps/:mapId/permissions/users',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const body = grantUserPermissionSchema.parse(req.body);

      if (!body.email && !body.userId) {
        throw ApiError.badRequest('Either email or userId required');
      }

      // Find user
      let user;
      if (body.userId) {
        user = await usersRepository.findById(body.userId);
      } else if (body.email) {
        user = await usersRepository.findByEmail(body.email);
      }

      if (!user) {
        throw ApiError.notFound('User not found');
      }

      // Find role
      const role = await permissionsRepository.findRoleByName(body.role);
      if (!role) {
        throw ApiError.badRequest('Invalid role');
      }

      const permission = await permissionsRepository.grantUserPermission({
        mapId: req.params.mapId,
        userId: user.id,
        roleId: role.id,
        grantedBy: req.user!.id,
        permissionOverrides: body.overrides,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });

      await auditRepository.create({
        action: 'permission.grant_user',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'permission',
        targetId: permission.id,
        details: {
          mapId: req.params.mapId,
          grantedTo: user.email,
          role: body.role,
        },
      });

      res.status(201).json({
        id: permission.id,
        userId: permission.userId,
        role: body.role,
        grantedAt: permission.grantedAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update user permission
router.put(
  '/maps/:mapId/permissions/users/:userId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const body = z.object({
        role: z.enum(['viewer', 'operator', 'editor', 'admin', 'restricted_operator']).optional(),
        overrides: z.object({
          components: z.record(z.object({
            allow: z.array(z.string()).optional(),
            deny: z.array(z.string()).optional(),
          })).optional(),
        }).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
      }).parse(req.body);

      let roleId: string | undefined;
      if (body.role) {
        const role = await permissionsRepository.findRoleByName(body.role);
        if (!role) {
          throw ApiError.badRequest('Invalid role');
        }
        roleId = role.id;
      }

      const updated = await permissionsRepository.updateUserPermission(
        req.params.mapId,
        req.params.userId,
        {
          roleId,
          permissionOverrides: body.overrides,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : body.expiresAt === null ? null : undefined,
        }
      );

      if (!updated) {
        throw ApiError.notFound('Permission not found');
      }

      await auditRepository.create({
        action: 'permission.update_user',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'permission',
        targetId: updated.id,
        details: { changes: body },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Revoke user permission
router.delete(
  '/maps/:mapId/permissions/users/:userId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const deleted = await permissionsRepository.revokeUserPermission(
        req.params.mapId,
        req.params.userId
      );

      if (!deleted) {
        throw ApiError.notFound('Permission not found');
      }

      await auditRepository.create({
        action: 'permission.revoke_user',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'permission',
        details: { mapId: req.params.mapId, revokedFrom: req.params.userId },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Grant group permission
router.post(
  '/maps/:mapId/permissions/groups',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const body = grantGroupPermissionSchema.parse(req.body);

      const role = await permissionsRepository.findRoleByName(body.role);
      if (!role) {
        throw ApiError.badRequest('Invalid role');
      }

      const permission = await permissionsRepository.grantGroupPermission({
        mapId: req.params.mapId,
        groupId: body.groupId,
        roleId: role.id,
        grantedBy: req.user!.id,
        permissionOverrides: body.overrides,
      });

      await auditRepository.create({
        action: 'permission.grant_group',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'permission',
        targetId: permission.id,
        details: {
          mapId: req.params.mapId,
          groupId: body.groupId,
          role: body.role,
        },
      });

      res.status(201).json(permission);
    } catch (error) {
      next(error);
    }
  }
);

// Revoke group permission
router.delete(
  '/maps/:mapId/permissions/groups/:groupId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const deleted = await permissionsRepository.revokeGroupPermission(
        req.params.mapId,
        req.params.groupId
      );

      if (!deleted) {
        throw ApiError.notFound('Permission not found');
      }

      await auditRepository.create({
        action: 'permission.revoke_group',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'permission',
        details: { mapId: req.params.mapId, groupId: req.params.groupId },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Create share link
router.post(
  '/maps/:mapId/share-links',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const body = createShareLinkSchema.parse(req.body);

      const role = await permissionsRepository.findRoleByName(body.role);
      if (!role) {
        throw ApiError.badRequest('Invalid role');
      }

      let passwordHash: string | undefined;
      if (body.password) {
        passwordHash = await bcrypt.hash(body.password, 12);
      }

      const shareLink = await permissionsRepository.createShareLink({
        mapId: req.params.mapId,
        roleId: role.id,
        createdBy: req.user!.id,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        maxUses: body.maxUses,
        passwordHash,
      });

      await auditRepository.create({
        action: 'share_link.create',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'map',
        targetId: req.params.mapId,
        details: { role: body.role, expiresAt: body.expiresAt },
      });

      res.status(201).json({
        id: shareLink.id,
        url: `/shared/${shareLink.token}`,
        token: shareLink.token,
        expiresAt: shareLink.expiresAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete share link
router.delete(
  '/maps/:mapId/share-links/:linkId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkAdminAccess(req.user!.id, req.params.mapId);

      const deleted = await permissionsRepository.deleteShareLink(req.params.linkId);

      if (!deleted) {
        throw ApiError.notFound('Share link not found');
      }

      await auditRepository.create({
        action: 'share_link.delete',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'map',
        targetId: req.params.mapId,
        details: { linkId: req.params.linkId },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Check permission
router.get(
  '/maps/:mapId/permissions/check',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permission = req.query.permission as string;
      const componentId = req.query.componentId as string | undefined;

      if (!permission) {
        throw ApiError.badRequest('Permission query parameter required');
      }

      const result = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        permission,
        componentId
      );

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get effective permissions
router.get(
  '/maps/:mapId/permissions/effective',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const map = await mapsRepository.findById(req.params.mapId);
      if (!map) {
        throw ApiError.notFound('Map not found');
      }

      // Get user's direct permission
      const userPerm = await permissionsRepository.findUserPermission(
        req.params.mapId,
        req.user!.id
      );

      // Get user's group permissions
      const groupPerms = await permissionsRepository.findUserGroupPermissions(
        req.params.mapId,
        req.user!.id
      );

      const isOwner = map.ownerId === req.user!.id;

      let effectiveRole = 'none';
      let permissions: Record<string, string[]> = {
        map: [],
        component: [],
        action: [],
      };

      if (isOwner) {
        effectiveRole = 'owner';
        permissions = {
          map: ['view', 'edit', 'delete', 'share', 'admin'],
          component: ['*'],
          action: ['*'],
        };
      } else if (userPerm) {
        const role = await permissionsRepository.findRoleById(userPerm.roleId);
        if (role) {
          effectiveRole = role.name;
          permissions = role.permissions;
        }
      } else if (groupPerms.length > 0) {
        // Use first group's role (TODO: merge permissions)
        const role = await permissionsRepository.findRoleById(groupPerms[0].roleId);
        if (role) {
          effectiveRole = role.name;
          permissions = role.permissions;
        }
      }

      res.json({
        isOwner,
        role: effectiveRole,
        effectivePermissions: permissions,
        overrides: userPerm?.permissionOverrides || {},
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get available roles
router.get('/roles', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await permissionsRepository.listRoles();
    res.json({ data: roles });
  } catch (error) {
    next(error);
  }
});

export default router;
