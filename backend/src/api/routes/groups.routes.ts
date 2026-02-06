import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { groupsRepository } from '../../db/repositories/index.js';

const router = Router();

// List groups in an organization
router.get(
  '/organizations/:orgId/groups',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = await groupsRepository.findByOrganization(req.params.orgId);

      // Enrich with member counts
      const enriched = await Promise.all(
        groups.map(async (group) => ({
          ...group,
          memberCount: await groupsRepository.getMemberCount(group.id),
        }))
      );

      res.json({ data: enriched });
    } catch (error) {
      next(error);
    }
  }
);

// Create group
router.post(
  '/organizations/:orgId/groups',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Group name is required' });
        return;
      }

      const group = await groupsRepository.create({
        organizationId: req.params.orgId,
        name,
        description,
      });

      res.status(201).json(group);
    } catch (error) {
      next(error);
    }
  }
);

// Get single group
router.get(
  '/groups/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const group = await groupsRepository.findById(req.params.id);
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      const members = await groupsRepository.getMembers(group.id);

      res.json({ ...group, members });
    } catch (error) {
      next(error);
    }
  }
);

// Update group
router.put(
  '/groups/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, description } = req.body;

      const group = await groupsRepository.update(req.params.id, { name, description });
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.json(group);
    } catch (error) {
      next(error);
    }
  }
);

// Delete group
router.delete(
  '/groups/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await groupsRepository.delete(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Add member to group
router.post(
  '/groups/:id/members',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }

      const member = await groupsRepository.addMember(req.params.id, userId);
      res.status(201).json(member);
    } catch (error) {
      next(error);
    }
  }
);

// Remove member from group
router.delete(
  '/groups/:id/members/:userId',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await groupsRepository.removeMember(req.params.id, req.params.userId);
      if (!removed) {
        res.status(404).json({ error: 'Member not found in group' });
        return;
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// List members of group
router.get(
  '/groups/:id/members',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await groupsRepository.getMembers(req.params.id);
      res.json({ data: members });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
