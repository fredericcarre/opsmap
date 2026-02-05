import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import {
  mapsRepository,
  workspacesRepository,
  permissionsRepository,
  auditRepository,
  organizationsRepository,
} from '../../db/repositories/index.js';
const router = Router();

const createMapSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  gitRepoUrl: z.string().url().optional(),
  gitBranch: z.string().optional(),
  yaml: z.string().optional(),
});

const updateMapSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  gitRepoUrl: z.string().url().optional().nullable(),
  gitBranch: z.string().optional(),
  yaml: z.string().optional(),
});

// Helper to check map access
async function checkMapAccess(
  userId: string,
  mapId: string,
  permission: string
): Promise<void> {
  const map = await mapsRepository.findById(mapId);
  if (!map) {
    throw ApiError.notFound('Map not found');
  }

  const result = await permissionsRepository.checkPermission(userId, mapId, permission);
  if (!result.allowed) {
    throw ApiError.forbidden(result.reason, 'PERMISSION_DENIED');
  }
}

// List maps (accessible by user)
router.get('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.query.workspaceId as string | undefined;
    const maps = await mapsRepository.findAccessible(req.user!.id, workspaceId);

    res.json({
      data: maps.map((m) => ({
        id: m.id,
        workspaceId: m.workspaceId,
        name: m.name,
        slug: m.slug,
        description: m.description,
        ownerId: m.ownerId,
        gitRepoUrl: m.gitRepoUrl,
        gitBranch: m.gitBranch,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get single map
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkMapAccess(req.user!.id, req.params.id, 'map:view');

    const map = await mapsRepository.findById(req.params.id);

    res.json(map);
  } catch (error) {
    next(error);
  }
});

// Create map
router.post('/', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createMapSchema.parse(req.body);

    // Check workspace exists and user has access
    const workspace = await workspacesRepository.findById(body.workspaceId);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found');
    }

    // Check user is member of organization
    const membership = await organizationsRepository.findMembership(
      workspace.organizationId,
      req.user!.id
    );
    if (!membership) {
      throw ApiError.forbidden('Not a member of this organization');
    }

    // Check slug uniqueness
    const existing = await mapsRepository.findBySlug(body.workspaceId, body.slug);
    if (existing) {
      throw ApiError.conflict('Map with this slug already exists in workspace');
    }

    const map = await mapsRepository.create({
      ...body,
      ownerId: req.user!.id,
    });

    await auditRepository.create({
      action: 'map.create',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'map',
      targetId: map.id,
      details: { mapName: map.name, workspaceId: body.workspaceId },
      organizationId: workspace.organizationId,
    });

    res.status(201).json(map);
  } catch (error) {
    next(error);
  }
});

// Update map
router.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkMapAccess(req.user!.id, req.params.id, 'map:edit');

    const body = updateMapSchema.parse(req.body);

    // Check slug uniqueness if changing
    if (body.slug) {
      const map = await mapsRepository.findById(req.params.id);
      if (map) {
        const existing = await mapsRepository.findBySlug(map.workspaceId, body.slug);
        if (existing && existing.id !== req.params.id) {
          throw ApiError.conflict('Map with this slug already exists in workspace');
        }
      }
    }

    const updated = await mapsRepository.update(req.params.id, body);
    if (!updated) {
      throw ApiError.notFound('Map not found');
    }

    await auditRepository.create({
      action: 'map.update',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'map',
      targetId: req.params.id,
      details: { changes: body },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Delete map
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkMapAccess(req.user!.id, req.params.id, 'map:delete');

    const map = await mapsRepository.findById(req.params.id);
    const deleted = await mapsRepository.deleteMap(req.params.id);

    if (!deleted) {
      throw ApiError.notFound('Map not found');
    }

    await auditRepository.create({
      action: 'map.delete',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'map',
      targetId: req.params.id,
      details: { mapName: map?.name },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Transfer ownership
router.post('/:id/transfer', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const map = await mapsRepository.findById(req.params.id);
    if (!map) {
      throw ApiError.notFound('Map not found');
    }

    // Only owner can transfer
    if (map.ownerId !== req.user!.id) {
      throw ApiError.forbidden('Only the owner can transfer ownership');
    }

    const { newOwnerId } = z.object({ newOwnerId: z.string().uuid() }).parse(req.body);

    const updated = await mapsRepository.transferOwnership(req.params.id, newOwnerId);

    await auditRepository.create({
      action: 'map.transfer_ownership',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'map',
      targetId: req.params.id,
      details: { previousOwner: map.ownerId, newOwner: newOwnerId },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
