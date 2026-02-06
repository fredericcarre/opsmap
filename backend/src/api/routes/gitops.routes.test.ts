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

vi.mock('../../gitops/map-sync.js', () => ({
  mapSyncService: {
    exportMap: vi.fn(),
    importMap: vi.fn(),
    diff: vi.fn(),
    syncFromGit: vi.fn(),
  },
}));

import gitopsRoutes from './gitops.routes.js';
import { mapSyncService } from '../../gitops/map-sync.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', gitopsRoutes);
  return app;
}

describe('gitops routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /maps/:mapId/export', () => {
    it('should export a map definition', async () => {
      const mockDefinition = {
        name: 'Production',
        components: [
          { id: 'c1', name: 'Web Server', type: 'service' },
        ],
      };
      vi.mocked(mapSyncService.exportMap).mockResolvedValue(mockDefinition);

      const res = await request(createApp())
        .get('/api/v1/maps/map-123/export')
        .expect(200);

      expect(res.body).toEqual(mockDefinition);
      expect(mapSyncService.exportMap).toHaveBeenCalledWith('map-123');
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(mapSyncService.exportMap).mockRejectedValue(new Error('Map not found'));

      const res = await request(createApp())
        .get('/api/v1/maps/map-123/export')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('POST /maps/:mapId/import', () => {
    it('should import a valid map definition', async () => {
      const definition = {
        components: [
          { id: 'c1', name: 'Web Server', type: 'service' },
        ],
      };
      const mockResult = { created: 1, updated: 0, deleted: 0 };
      vi.mocked(mapSyncService.importMap).mockResolvedValue(mockResult);

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import')
        .send(definition)
        .expect(200);

      expect(res.body).toEqual(mockResult);
      expect(mapSyncService.importMap).toHaveBeenCalledWith('map-123', definition);
    });

    it('should return 400 if body is missing components', async () => {
      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import')
        .send({ name: 'No components' })
        .expect(400);

      expect(res.body).toEqual({
        error: 'Invalid map definition. Must include "components" array.',
      });
      expect(mapSyncService.importMap).not.toHaveBeenCalled();
    });

    it('should return 400 if body is empty', async () => {
      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import')
        .send({})
        .expect(400);

      expect(res.body.error).toContain('components');
      expect(mapSyncService.importMap).not.toHaveBeenCalled();
    });

    it('should pass errors to the error handler', async () => {
      const definition = { components: [{ id: 'c1' }] };
      vi.mocked(mapSyncService.importMap).mockRejectedValue(new Error('Import failed'));

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import')
        .send(definition)
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('POST /maps/:mapId/import/preview', () => {
    it('should return a diff preview', async () => {
      const definition = {
        components: [
          { id: 'c1', name: 'Web Server', type: 'service' },
        ],
      };
      const mockDiff = {
        added: ['Web Server'],
        removed: [],
        changed: [],
        unchanged: [],
      };
      vi.mocked(mapSyncService.diff).mockResolvedValue(mockDiff);

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import/preview')
        .send(definition)
        .expect(200);

      expect(res.body).toEqual(mockDiff);
      expect(mapSyncService.diff).toHaveBeenCalledWith('map-123', definition);
    });

    it('should return 400 if body is missing components', async () => {
      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import/preview')
        .send({ name: 'No components' })
        .expect(400);

      expect(res.body).toEqual({
        error: 'Invalid map definition. Must include "components" array.',
      });
      expect(mapSyncService.diff).not.toHaveBeenCalled();
    });

    it('should pass errors to the error handler', async () => {
      const definition = { components: [{ id: 'c1' }] };
      vi.mocked(mapSyncService.diff).mockRejectedValue(new Error('Diff failed'));

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/import/preview')
        .send(definition)
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });

  describe('POST /maps/:mapId/sync', () => {
    it('should sync a map from Git successfully', async () => {
      const mockResult = { synced: true, message: 'Synced 3 components' };
      vi.mocked(mapSyncService.syncFromGit).mockResolvedValue(mockResult);

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/sync')
        .expect(200);

      expect(res.body).toEqual(mockResult);
      expect(mapSyncService.syncFromGit).toHaveBeenCalledWith('map-123');
    });

    it('should return 400 if the map is not synced to Git', async () => {
      const mockResult = { synced: false, message: 'Map is not configured for Git sync' };
      vi.mocked(mapSyncService.syncFromGit).mockResolvedValue(mockResult);

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/sync')
        .expect(400);

      expect(res.body).toEqual({ error: 'Map is not configured for Git sync' });
    });

    it('should pass errors to the error handler', async () => {
      vi.mocked(mapSyncService.syncFromGit).mockRejectedValue(new Error('Git error'));

      const res = await request(createApp())
        .post('/api/v1/maps/map-123/sync')
        .expect(500);

      expect(res.body).toBeDefined();
    });
  });
});
