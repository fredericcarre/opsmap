import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { mapSyncService } from '../../gitops/map-sync.js';

const router = Router();

// Export a map as a definition (JSON)
router.get(
  '/maps/:mapId/export',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const definition = await mapSyncService.exportMap(req.params.mapId);
      res.json(definition);
    } catch (error) {
      next(error);
    }
  }
);

// Import a map definition
router.post(
  '/maps/:mapId/import',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const definition = req.body;

      if (!definition || !definition.components) {
        res.status(400).json({ error: 'Invalid map definition. Must include "components" array.' });
        return;
      }

      const result = await mapSyncService.importMap(req.params.mapId, definition);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Preview import (diff without applying)
router.post(
  '/maps/:mapId/import/preview',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const definition = req.body;

      if (!definition || !definition.components) {
        res.status(400).json({ error: 'Invalid map definition. Must include "components" array.' });
        return;
      }

      const diff = await mapSyncService.diff(req.params.mapId, definition);
      res.json(diff);
    } catch (error) {
      next(error);
    }
  }
);

// Sync a map from its configured Git repository
router.post(
  '/maps/:mapId/sync',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await mapSyncService.syncFromGit(req.params.mapId);

      if (!result.synced) {
        res.status(400).json({ error: result.message });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
