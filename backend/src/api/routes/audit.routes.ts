import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { auditRepository } from '../../db/repositories/index.js';

const router = Router();

// List audit logs with filtering
router.get(
  '/audit-logs',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        organizationId,
        targetType,
        targetId,
        action,
        startDate,
        endDate,
        page,
        pageSize,
      } = req.query;

      const filter = {
        organizationId: organizationId as string | undefined,
        actorId: req.query.actorId as string | undefined,
        targetType: targetType as string | undefined,
        targetId: targetId as string | undefined,
        action: action as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page ? parseInt(page as string, 10) : 1,
        pageSize: pageSize ? Math.min(parseInt(pageSize as string, 10), 100) : 50,
      };

      const { logs, total } = await auditRepository.find(filter);

      res.json({
        data: logs,
        pagination: {
          page: filter.page,
          pageSize: filter.pageSize,
          totalItems: total,
          totalPages: Math.ceil(total / filter.pageSize!),
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get audit logs for a specific target (e.g., a map or component)
router.get(
  '/audit-logs/target/:targetType/:targetId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { targetType, targetId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const logs = await auditRepository.findByTarget(targetType, targetId, Math.min(limit, 100));

      res.json({ data: logs });
    } catch (error) {
      next(error);
    }
  }
);

// Get recent audit logs for an organization
router.get(
  '/organizations/:orgId/audit-logs',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const logs = await auditRepository.findRecent(req.params.orgId, Math.min(limit, 500));

      res.json({ data: logs });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
