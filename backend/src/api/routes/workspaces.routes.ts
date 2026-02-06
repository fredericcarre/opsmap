import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import {
  workspacesRepository,
  organizationsRepository,
  auditRepository,
} from '../../db/repositories/index.js';

const router = Router();

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
});

// Get single workspace
router.get('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await workspacesRepository.findById(req.params.id);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found');
    }

    // Check user belongs to the organization
    const membership = await organizationsRepository.findMembership(
      workspace.organizationId,
      req.user!.id
    );
    if (!membership) {
      throw ApiError.forbidden('Not a member of this organization');
    }

    res.json(workspace);
  } catch (error) {
    next(error);
  }
});

// Update workspace
router.put('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await workspacesRepository.findById(req.params.id);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found');
    }

    // Check user is admin/owner of org
    const membership = await organizationsRepository.findMembership(
      workspace.organizationId,
      req.user!.id
    );
    if (!membership || membership.role === 'member') {
      throw ApiError.forbidden('Only admins can update workspaces');
    }

    const body = updateWorkspaceSchema.parse(req.body);

    // Check slug uniqueness if changing
    if (body.slug) {
      const existing = await workspacesRepository.findBySlug(workspace.organizationId, body.slug);
      if (existing && existing.id !== req.params.id) {
        throw ApiError.conflict('Workspace with this slug already exists');
      }
    }

    const updated = await workspacesRepository.update(req.params.id, body);
    if (!updated) {
      throw ApiError.notFound('Workspace not found');
    }

    await auditRepository.create({
      action: 'workspace.update',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'workspace',
      targetId: req.params.id,
      details: { changes: body },
      organizationId: workspace.organizationId,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Delete workspace
router.delete('/:id', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspace = await workspacesRepository.findById(req.params.id);
    if (!workspace) {
      throw ApiError.notFound('Workspace not found');
    }

    // Check user is admin/owner of org
    const membership = await organizationsRepository.findMembership(
      workspace.organizationId,
      req.user!.id
    );
    if (!membership || membership.role === 'member') {
      throw ApiError.forbidden('Only admins can delete workspaces');
    }

    const deleted = await workspacesRepository.deleteWorkspace(req.params.id);
    if (!deleted) {
      throw ApiError.notFound('Workspace not found');
    }

    await auditRepository.create({
      action: 'workspace.delete',
      actorType: 'user',
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      actorIp: req.ip,
      targetType: 'workspace',
      targetId: req.params.id,
      details: { workspaceName: workspace.name },
      organizationId: workspace.organizationId,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
