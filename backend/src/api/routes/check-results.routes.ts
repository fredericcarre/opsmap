import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkResultsRepository } from '../../db/repositories/index.js';

const router = Router();

// Get status of all components in a map
router.get(
  '/maps/:mapId/status',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await checkResultsRepository.getMapStatus(req.params.mapId);
      res.json({ data: status });
    } catch (error) {
      next(error);
    }
  }
);

// Get check results for a component
router.get(
  '/maps/:mapId/components/:componentId/checks',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const checkName = req.query.checkName as string | undefined;

      let results;
      if (checkName) {
        results = await checkResultsRepository.findByComponentAndCheck(
          req.params.componentId, checkName, Math.min(limit, 500)
        );
      } else {
        results = await checkResultsRepository.findByComponent(
          req.params.componentId, Math.min(limit, 500)
        );
      }

      res.json({ data: results });
    } catch (error) {
      next(error);
    }
  }
);

// Get current status of a component (latest check results)
router.get(
  '/maps/:mapId/components/:componentId/status',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await checkResultsRepository.getComponentStatus(req.params.componentId);
      res.json(status);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
