import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { ApiError } from '../middleware/error.js';
import {
  mapsRepository,
  componentsRepository,
  permissionsRepository,
  auditRepository,
} from '../../db/repositories/index.js';
import { commandService } from '../../gateway/command.service.js';
import { createChildLogger } from '../../config/logger.js';

const logger = createChildLogger('components-routes');
const router = Router();

const createComponentSchema = z.object({
  externalId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  config: z.record(z.unknown()).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
});

const updateComponentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
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

// List components for a map
router.get(
  '/maps/:mapId/components',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkMapAccess(req.user!.id, req.params.mapId, 'component:view');

      const components = await componentsRepository.findByMap(req.params.mapId);

      res.json({ data: components });
    } catch (error) {
      next(error);
    }
  }
);

// Get single component
router.get(
  '/maps/:mapId/components/:componentId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkMapAccess(req.user!.id, req.params.mapId, 'component:view');

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      res.json(component);
    } catch (error) {
      next(error);
    }
  }
);

// Create component
router.post(
  '/maps/:mapId/components',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkMapAccess(req.user!.id, req.params.mapId, 'component:edit');

      const body = createComponentSchema.parse(req.body);

      // Check for duplicate external ID
      const existing = await componentsRepository.findByExternalId(
        req.params.mapId,
        body.externalId
      );
      if (existing) {
        throw ApiError.conflict('Component with this external ID already exists');
      }

      const component = await componentsRepository.create({
        mapId: req.params.mapId,
        ...body,
      });

      await auditRepository.create({
        action: 'component.create',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: component.id,
        details: {
          mapId: req.params.mapId,
          componentName: component.name,
          componentType: component.type,
        },
      });

      res.status(201).json(component);
    } catch (error) {
      next(error);
    }
  }
);

// Update component
router.put(
  '/maps/:mapId/components/:componentId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkMapAccess(req.user!.id, req.params.mapId, 'component:edit');

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      const body = updateComponentSchema.parse(req.body);
      const updated = await componentsRepository.update(req.params.componentId, body);

      await auditRepository.create({
        action: 'component.update',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: { changes: body },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Delete component
router.delete(
  '/maps/:mapId/components/:componentId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await checkMapAccess(req.user!.id, req.params.mapId, 'component:edit');

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      await componentsRepository.deleteComponent(req.params.componentId);

      await auditRepository.create({
        action: 'component.delete',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: { componentName: component.name },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Component actions
router.post(
  '/maps/:mapId/components/:componentId/actions/:actionName',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { actionName } = req.params;

      // Check action permission
      const permResult = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        `action:execute`,
        req.params.componentId
      );
      if (!permResult.allowed) {
        throw ApiError.forbidden(permResult.reason, 'PERMISSION_DENIED');
      }

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      // Check if action exists in component config
      const actions = (component.config.actions || []) as Array<{ name: string }>;
      const action = actions.find((a) => a.name === actionName);
      if (!action) {
        throw ApiError.notFound('Action not found');
      }

      // Execute action via Gateway
      const result = await commandService.executeComponentCommand({
        mapId: req.params.mapId,
        componentId: req.params.componentId,
        commandName: actionName,
        userId: req.user!.id,
        params: req.body,
      });

      await auditRepository.create({
        action: `component.action.${actionName}`,
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: {
          mapId: req.params.mapId,
          componentName: component.name,
          actionName,
          params: req.body,
          jobId: result.jobId,
        },
      });

      if (!result.success) {
        throw ApiError.badRequest(result.error || 'Failed to execute action');
      }

      res.json({
        message: result.message,
        jobId: result.jobId,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Start component
router.post(
  '/maps/:mapId/components/:componentId/start',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permResult = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        'component:start',
        req.params.componentId
      );
      if (!permResult.allowed) {
        throw ApiError.forbidden(permResult.reason, 'PERMISSION_DENIED');
      }

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      // Execute start command via Gateway
      const result = await commandService.executeComponentCommand({
        mapId: req.params.mapId,
        componentId: req.params.componentId,
        commandName: 'start',
        userId: req.user!.id,
      });

      await auditRepository.create({
        action: 'component.start',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: { componentName: component.name, jobId: result.jobId },
      });

      if (!result.success) {
        throw ApiError.badRequest(result.error || 'Failed to start component');
      }

      res.json({ message: result.message, jobId: result.jobId });
    } catch (error) {
      next(error);
    }
  }
);

// Stop component
router.post(
  '/maps/:mapId/components/:componentId/stop',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permResult = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        'component:stop',
        req.params.componentId
      );
      if (!permResult.allowed) {
        throw ApiError.forbidden(permResult.reason, 'PERMISSION_DENIED');
      }

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      // Execute stop command via Gateway
      const result = await commandService.executeComponentCommand({
        mapId: req.params.mapId,
        componentId: req.params.componentId,
        commandName: 'stop',
        userId: req.user!.id,
      });

      await auditRepository.create({
        action: 'component.stop',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: { componentName: component.name, jobId: result.jobId },
      });

      if (!result.success) {
        throw ApiError.badRequest(result.error || 'Failed to stop component');
      }

      res.json({ message: result.message, jobId: result.jobId });
    } catch (error) {
      next(error);
    }
  }
);

// Restart component
router.post(
  '/maps/:mapId/components/:componentId/restart',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permResult = await permissionsRepository.checkPermission(
        req.user!.id,
        req.params.mapId,
        'component:restart',
        req.params.componentId
      );
      if (!permResult.allowed) {
        throw ApiError.forbidden(permResult.reason, 'PERMISSION_DENIED');
      }

      const component = await componentsRepository.findById(req.params.componentId);
      if (!component || component.mapId !== req.params.mapId) {
        throw ApiError.notFound('Component not found');
      }

      // Execute restart command via Gateway
      const result = await commandService.executeComponentCommand({
        mapId: req.params.mapId,
        componentId: req.params.componentId,
        commandName: 'restart',
        userId: req.user!.id,
      });

      await auditRepository.create({
        action: 'component.restart',
        actorType: 'user',
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        actorIp: req.ip,
        targetType: 'component',
        targetId: req.params.componentId,
        details: { componentName: component.name, jobId: result.jobId },
      });

      if (!result.success) {
        throw ApiError.badRequest(result.error || 'Failed to restart component');
      }

      res.json({ message: result.message, jobId: result.jobId });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
