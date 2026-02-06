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

vi.mock('../../db/repositories/index.js', () => ({
  checkResultsRepository: {
    getMapStatus: vi.fn(),
    findByComponent: vi.fn(),
    findByComponentAndCheck: vi.fn(),
    getComponentStatus: vi.fn(),
  },
}));

import checkResultsRoutes from './check-results.routes.js';
import { checkResultsRepository } from '../../db/repositories/index.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', checkResultsRoutes);
  return app;
}

describe('check-results routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /maps/:mapId/status', () => {
    it('should return map status', async () => {
      const mockStatus = [
        { componentId: 'c1', componentName: 'web', status: 'ok', lastCheck: null },
        { componentId: 'c2', componentName: 'db', status: 'error', lastCheck: null },
      ];
      vi.mocked(checkResultsRepository.getMapStatus).mockResolvedValue(mockStatus);

      const res = await request(createApp())
        .get('/api/v1/maps/map-123/status')
        .expect(200);

      expect(res.body).toEqual({ data: mockStatus });
      expect(checkResultsRepository.getMapStatus).toHaveBeenCalledWith('map-123');
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(checkResultsRepository.getMapStatus).mockRejectedValue(new Error('DB error'));

      const res = await request(createApp())
        .get('/api/v1/maps/map-123/status')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('GET /maps/:mapId/components/:componentId/checks', () => {
    it('should return check results for a component without checkName filter', async () => {
      const mockResults = [
        { id: 'r1', checkName: 'cpu', status: 'ok' },
        { id: 'r2', checkName: 'memory', status: 'ok' },
      ] as any;
      vi.mocked(checkResultsRepository.findByComponent).mockResolvedValue(mockResults);

      const res = await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/checks')
        .expect(200);

      expect(res.body).toEqual({ data: mockResults });
      expect(checkResultsRepository.findByComponent).toHaveBeenCalledWith('comp-1', 100);
      expect(checkResultsRepository.findByComponentAndCheck).not.toHaveBeenCalled();
    });

    it('should filter by checkName when provided', async () => {
      const mockResults = [{ id: 'r1', checkName: 'cpu', status: 'ok' }] as any;
      vi.mocked(checkResultsRepository.findByComponentAndCheck).mockResolvedValue(mockResults);

      const res = await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/checks?checkName=cpu')
        .expect(200);

      expect(res.body).toEqual({ data: mockResults });
      expect(checkResultsRepository.findByComponentAndCheck).toHaveBeenCalledWith('comp-1', 'cpu', 100);
      expect(checkResultsRepository.findByComponent).not.toHaveBeenCalled();
    });

    it('should respect the limit query parameter capped at 500', async () => {
      vi.mocked(checkResultsRepository.findByComponent).mockResolvedValue([]);

      await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/checks?limit=1000')
        .expect(200);

      expect(checkResultsRepository.findByComponent).toHaveBeenCalledWith('comp-1', 500);
    });

    it('should use parsed limit when under 500', async () => {
      vi.mocked(checkResultsRepository.findByComponent).mockResolvedValue([]);

      await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/checks?limit=50')
        .expect(200);

      expect(checkResultsRepository.findByComponent).toHaveBeenCalledWith('comp-1', 50);
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(checkResultsRepository.findByComponent).mockRejectedValue(new Error('DB error'));

      const res = await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/checks')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('GET /maps/:mapId/components/:componentId/status', () => {
    it('should return component status', async () => {
      const mockStatus = { componentId: 'comp-1', status: 'ok', checks: [] };
      vi.mocked(checkResultsRepository.getComponentStatus).mockResolvedValue(mockStatus);

      const res = await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/status')
        .expect(200);

      expect(res.body).toEqual(mockStatus);
      expect(checkResultsRepository.getComponentStatus).toHaveBeenCalledWith('comp-1');
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(checkResultsRepository.getComponentStatus).mockRejectedValue(new Error('DB error'));

      const res = await request(createApp())
        .get('/api/v1/maps/map-1/components/comp-1/status')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });
});
