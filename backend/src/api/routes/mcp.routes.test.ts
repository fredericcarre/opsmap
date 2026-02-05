import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../config/index.js', () => ({
  config: {
    logging: { level: 'silent' },
    nodeEnv: 'test',
  },
}));

vi.mock('../../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../mcp/server.js', () => ({
  mcpServer: {
    handleRequest: vi.fn(),
  },
}));

import mcpRoutes from './mcp.routes.js';
import { mcpServer } from '../../mcp/server.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', mcpRoutes);
  return app;
}

describe('mcp routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /mcp/tools', () => {
    it('should return the list of MCP tools', async () => {
      const mockTools = {
        tools: [
          { name: 'get_map_status', description: 'Get the status of a map' },
          { name: 'list_maps', description: 'List all maps' },
        ],
      };
      vi.mocked(mcpServer.handleRequest).mockResolvedValue({ result: mockTools });

      const res = await request(createApp())
        .get('/api/v1/mcp/tools')
        .expect(200);

      expect(res.body).toEqual(mockTools);
      expect(mcpServer.handleRequest).toHaveBeenCalledWith({ method: 'tools/list' });
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(mcpServer.handleRequest).mockRejectedValue(new Error('MCP error'));

      const res = await request(createApp())
        .get('/api/v1/mcp/tools')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('POST /mcp/tools/call', () => {
    it('should execute an MCP tool and return the result', async () => {
      const mockResult = { content: [{ type: 'text', text: 'Map is healthy' }] };
      vi.mocked(mcpServer.handleRequest).mockResolvedValue({ result: mockResult });

      const res = await request(createApp())
        .post('/api/v1/mcp/tools/call')
        .send({ name: 'get_map_status', arguments: { mapId: 'map-1' } })
        .expect(200);

      expect(res.body).toEqual(mockResult);
      expect(mcpServer.handleRequest).toHaveBeenCalledWith({
        method: 'tools/call',
        params: { name: 'get_map_status', arguments: { mapId: 'map-1' } },
      });
    });

    it('should return 400 if tool name is missing', async () => {
      const res = await request(createApp())
        .post('/api/v1/mcp/tools/call')
        .send({ arguments: { mapId: 'map-1' } })
        .expect(400);

      expect(res.body).toEqual({ error: 'Tool name is required' });
      expect(mcpServer.handleRequest).not.toHaveBeenCalled();
    });

    it('should default arguments to empty object when not provided', async () => {
      const mockResult = { content: [{ type: 'text', text: 'done' }] };
      vi.mocked(mcpServer.handleRequest).mockResolvedValue({ result: mockResult });

      await request(createApp())
        .post('/api/v1/mcp/tools/call')
        .send({ name: 'list_maps' })
        .expect(200);

      expect(mcpServer.handleRequest).toHaveBeenCalledWith({
        method: 'tools/call',
        params: { name: 'list_maps', arguments: {} },
      });
    });

    it('should return 400 if the MCP response contains an error', async () => {
      vi.mocked(mcpServer.handleRequest).mockResolvedValue({
        error: { code: -32601, message: 'Tool not found' },
      });

      const res = await request(createApp())
        .post('/api/v1/mcp/tools/call')
        .send({ name: 'nonexistent_tool' })
        .expect(400);

      expect(res.body).toEqual({ error: 'Tool not found' });
    });

    it('should pass unexpected errors to the error handler', async () => {
      vi.mocked(mcpServer.handleRequest).mockRejectedValue(new Error('Unexpected'));

      const res = await request(createApp())
        .post('/api/v1/mcp/tools/call')
        .send({ name: 'get_map_status' })
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });
});
