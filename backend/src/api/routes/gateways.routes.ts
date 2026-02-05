import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { gatewaysRepository, agentsRepository, jobsRepository } from '../../db/repositories/index.js';
import { gatewayManager, commandService } from '../../gateway/index.js';
const router = Router();

// List all gateways
router.get(
  '/gateways',
  authMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const gateways = await gatewaysRepository.findAll();

      // Enrich with live connection status
      const connectedGateways = new Set(
        gatewayManager.getConnectedGateways().map((g) => g.id)
      );

      const enriched = gateways.map((gw) => ({
        ...gw,
        connected: connectedGateways.has(gw.id),
      }));

      res.json({ data: enriched });
    } catch (error) {
      next(error);
    }
  }
);

// Get single gateway
router.get(
  '/gateways/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gateway = await gatewaysRepository.findById(req.params.id);
      if (!gateway) {
        res.status(404).json({ error: 'Gateway not found' });
        return;
      }

      const agents = await agentsRepository.findByGateway(gateway.id);

      res.json({
        ...gateway,
        agents,
      });
    } catch (error) {
      next(error);
    }
  }
);

// List all agents
router.get(
  '/agents',
  authMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const agents = await agentsRepository.findAll();

      // Enrich with live connection status
      const onlineAgents = new Set(
        gatewayManager.getConnectedAgents().map((a) => a.id)
      );

      const enriched = agents.map((agent) => ({
        ...agent,
        connected: onlineAgents.has(agent.id),
      }));

      res.json({ data: enriched });
    } catch (error) {
      next(error);
    }
  }
);

// Get single agent
router.get(
  '/agents/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agent = await agentsRepository.findById(req.params.id);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const connected = gatewayManager.isAgentOnline(agent.id);

      res.json({
        ...agent,
        connected,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Send command to agent
router.post(
  '/agents/:id/command',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { command, args } = req.body;

      if (!command) {
        res.status(400).json({ error: 'Command is required' });
        return;
      }

      const result = await commandService.executeNativeCommand(
        req.params.id,
        command,
        args || {},
        req.user!.id
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get job status
router.get(
  '/jobs/:id',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await jobsRepository.findById(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(job);
    } catch (error) {
      next(error);
    }
  }
);

// Wait for job completion (long polling)
router.get(
  '/jobs/:id/wait',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timeout = parseInt(req.query.timeout as string) || 30000;
      const maxTimeout = Math.min(timeout, 60000); // Max 60 seconds

      const job = await commandService.waitForJobCompletion(req.params.id, maxTimeout);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      res.json(job);
    } catch (error) {
      next(error);
    }
  }
);

// Live connected gateways (from memory)
router.get(
  '/live/gateways',
  authMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const gateways = gatewayManager.getConnectedGateways();
      res.json({ data: gateways });
    } catch (error) {
      next(error);
    }
  }
);

// Live connected agents (from memory)
router.get(
  '/live/agents',
  authMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const agents = gatewayManager.getConnectedAgents();
      res.json({ data: agents });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
