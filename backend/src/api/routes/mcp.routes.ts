import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { mcpServer } from '../../mcp/server.js';

const router = Router();

// List available MCP tools
router.get(
  '/mcp/tools',
  authMiddleware,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const response = await mcpServer.handleRequest({ method: 'tools/list' });
      res.json(response.result);
    } catch (error) {
      next(error);
    }
  }
);

// Execute an MCP tool
router.post(
  '/mcp/tools/call',
  authMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, arguments: args } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Tool name is required' });
        return;
      }

      const response = await mcpServer.handleRequest({
        method: 'tools/call',
        params: { name, arguments: args || {} },
      });

      if (response.error) {
        res.status(400).json({ error: response.error.message });
        return;
      }

      res.json(response.result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
