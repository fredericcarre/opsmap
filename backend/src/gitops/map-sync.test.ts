import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../db/repositories/index.js', () => ({
  mapsRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
  componentsRepository: {
    findByMap: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteComponent: vi.fn(),
  },
}));

import { mapSyncService, type MapYAML } from './map-sync.js';
import { mapsRepository, componentsRepository } from '../db/repositories/index.js';

const mockMapsRepo = vi.mocked(mapsRepository);
const mockComponentsRepo = vi.mocked(componentsRepository);

describe('mapSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // parseMapYAML
  // ---------------------------------------------------------------------------
  describe('parseMapYAML', () => {
    it('should parse valid JSON content into MapYAML', () => {
      const input: MapYAML = {
        name: 'my-map',
        description: 'Test map',
        components: [
          {
            id: 'web-server',
            name: 'web-server',
            type: 'service',
            dependencies: ['database'],
          },
        ],
      };

      const result = mapSyncService.parseMapYAML(JSON.stringify(input));

      expect(result.name).toBe('my-map');
      expect(result.description).toBe('Test map');
      expect(result.components).toHaveLength(1);
      expect(result.components[0].name).toBe('web-server');
      expect(result.components[0].type).toBe('service');
      expect(result.components[0].dependencies).toEqual(['database']);
    });

    it('should parse content with full component details', () => {
      const input: MapYAML = {
        name: 'full-map',
        components: [
          {
            id: 'api',
            name: 'api',
            type: 'service',
            agent_selector: {
              agent_id: 'agent-1',
              labels: { env: 'production' },
            },
            checks: [
              {
                name: 'health',
                type: 'http',
                config: { url: 'http://localhost:8080/health' },
                interval_secs: 30,
                timeout_secs: 10,
              },
            ],
            actions: [
              {
                name: 'start',
                label: 'Start',
                command: 'systemctl start api',
                args: ['--force'],
                run_as_user: 'root',
                async: true,
                confirmation_required: true,
              },
            ],
            metadata: { version: '1.2.3' },
          },
        ],
      };

      const result = mapSyncService.parseMapYAML(JSON.stringify(input));

      expect(result.components[0].agent_selector?.agent_id).toBe('agent-1');
      expect(result.components[0].checks).toHaveLength(1);
      expect(result.components[0].actions).toHaveLength(1);
      expect(result.components[0].metadata).toEqual({ version: '1.2.3' });
    });

    it('should throw an error for invalid JSON', () => {
      expect(() => mapSyncService.parseMapYAML('not valid json {')).toThrow(
        'Invalid map definition format',
      );
    });

    it('should throw an error for empty string', () => {
      expect(() => mapSyncService.parseMapYAML('')).toThrow(
        'Invalid map definition format',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // exportMap
  // ---------------------------------------------------------------------------
  describe('exportMap', () => {
    it('should export a map with its components', async () => {
      mockMapsRepo.findById.mockResolvedValue({
        id: 'map-1',
        workspaceId: 'ws-1',
        name: 'Production',
        slug: 'production',
        description: 'Production environment',
        ownerId: 'user-1',
        gitRepoUrl: null,
        gitBranch: 'main',
        yaml: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          mapId: 'map-1',
          name: 'web-server',
          type: 'service',
          config: {
            agentSelector: { agentId: 'agent-1', labels: { role: 'web' } },
            dependencies: ['database'],
            checks: [
              {
                name: 'health',
                type: 'http',
                config: { url: 'http://localhost/health' },
                intervalSecs: 30,
                timeoutSecs: 10,
              },
            ],
            actions: [
              {
                name: 'restart',
                label: 'Restart',
                command: 'systemctl restart nginx',
                args: [],
                runAsUser: 'root',
                async: true,
                confirmationRequired: false,
              },
            ],
            metadata: { tier: 'frontend' },
          },
          position: { x: 0, y: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);

      const result = await mapSyncService.exportMap('map-1');

      expect(result.name).toBe('Production');
      expect(result.description).toBe('Production environment');
      expect(result.components).toHaveLength(1);

      const comp = result.components[0];
      expect(comp.id).toBe('web-server'); // uses name as external ID
      expect(comp.name).toBe('web-server');
      expect(comp.type).toBe('service');
      expect(comp.agent_selector).toEqual({
        agent_id: 'agent-1',
        labels: { role: 'web' },
      });
      expect(comp.dependencies).toEqual(['database']);
      expect(comp.checks).toHaveLength(1);
      expect(comp.checks![0].name).toBe('health');
      expect(comp.checks![0].interval_secs).toBe(30);
      expect(comp.checks![0].timeout_secs).toBe(10);
      expect(comp.actions).toHaveLength(1);
      expect(comp.actions![0].name).toBe('restart');
      expect(comp.actions![0].run_as_user).toBe('root');
      expect(comp.actions![0].async).toBe(true);
      expect(comp.metadata).toEqual({ tier: 'frontend' });
    });

    it('should export map with empty components list', async () => {
      mockMapsRepo.findById.mockResolvedValue({
        id: 'map-2',
        name: 'Empty Map',
        description: null,
      } as any);

      mockComponentsRepo.findByMap.mockResolvedValue([]);

      const result = await mapSyncService.exportMap('map-2');

      expect(result.name).toBe('Empty Map');
      expect(result.description).toBeUndefined();
      expect(result.components).toEqual([]);
    });

    it('should export component without agentSelector', async () => {
      mockMapsRepo.findById.mockResolvedValue({
        id: 'map-3',
        name: 'Simple Map',
        description: null,
      } as any);

      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          mapId: 'map-3',
          name: 'simple-comp',
          type: 'database',
          config: {},
          position: { x: 0, y: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);

      const result = await mapSyncService.exportMap('map-3');

      expect(result.components[0].agent_selector).toBeUndefined();
      expect(result.components[0].checks).toBeUndefined();
      expect(result.components[0].actions).toBeUndefined();
    });

    it('should throw when map is not found', async () => {
      mockMapsRepo.findById.mockResolvedValue(null);

      await expect(mapSyncService.exportMap('nonexistent')).rejects.toThrow(
        'Map nonexistent not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // importMap
  // ---------------------------------------------------------------------------
  describe('importMap', () => {
    const baseMap = {
      id: 'map-1',
      workspaceId: 'ws-1',
      name: 'Production',
      slug: 'production',
      description: 'Prod env',
      ownerId: 'user-1',
      gitRepoUrl: null,
      gitBranch: 'main',
      yaml: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    it('should create new components when none exist', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([]);
      mockComponentsRepo.create.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          { id: 'web', name: 'web-server', type: 'service' },
          { id: 'db', name: 'database', type: 'database' },
        ],
      };

      const result = await mapSyncService.importMap('map-1', definition);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.deleted).toBe(0);
      expect(mockComponentsRepo.create).toHaveBeenCalledTimes(2);
      expect(mockComponentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mapId: 'map-1',
          externalId: 'web',
          name: 'web-server',
          type: 'service',
        }),
      );
      expect(mockComponentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mapId: 'map-1',
          externalId: 'db',
          name: 'database',
          type: 'database',
        }),
      );
    });

    it('should update existing components that match by name', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-uuid-1',
          mapId: 'map-1',
          name: 'web-server',
          type: 'service',
          config: {},
          position: { x: 0, y: 0 },
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      mockComponentsRepo.update.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          {
            id: 'web',
            name: 'web-server',
            type: 'service',
            agent_selector: { agent_id: 'agent-2' },
          },
        ],
      };

      const result = await mapSyncService.importMap('map-1', definition);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.deleted).toBe(0);
      expect(mockComponentsRepo.update).toHaveBeenCalledWith(
        'comp-uuid-1',
        expect.objectContaining({
          name: 'web-server',
          type: 'service',
          config: expect.objectContaining({
            agentSelector: { agentId: 'agent-2', labels: undefined },
          }),
        }),
      );
    });

    it('should delete components not in the definition', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          mapId: 'map-1',
          name: 'web-server',
          type: 'service',
          config: {},
        } as any,
        {
          id: 'comp-2',
          mapId: 'map-1',
          name: 'old-cache',
          type: 'cache',
          config: {},
        } as any,
      ]);
      mockComponentsRepo.update.mockResolvedValue({} as any);
      mockComponentsRepo.deleteComponent.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          { id: 'web', name: 'web-server', type: 'service' },
        ],
      };

      const result = await mapSyncService.importMap('map-1', definition);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.deleted).toBe(1);
      expect(mockComponentsRepo.deleteComponent).toHaveBeenCalledWith('comp-2');
    });

    it('should handle mixed create, update, and delete', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          mapId: 'map-1',
          name: 'keep-me',
          type: 'service',
          config: {},
        } as any,
        {
          id: 'comp-2',
          mapId: 'map-1',
          name: 'remove-me',
          type: 'service',
          config: {},
        } as any,
      ]);
      mockComponentsRepo.update.mockResolvedValue({} as any);
      mockComponentsRepo.create.mockResolvedValue({} as any);
      mockComponentsRepo.deleteComponent.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          { id: 'keep', name: 'keep-me', type: 'service' },
          { id: 'new', name: 'new-component', type: 'queue' },
        ],
      };

      const result = await mapSyncService.importMap('map-1', definition);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.deleted).toBe(1);
    });

    it('should save the definition as YAML (JSON) on the map', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([]);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [],
      };

      await mapSyncService.importMap('map-1', definition);

      expect(mockMapsRepo.update).toHaveBeenCalledWith('map-1', {
        yaml: JSON.stringify(definition),
      });
    });

    it('should use component name as externalId when id is missing', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([]);
      mockComponentsRepo.create.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          { id: '', name: 'fallback-name', type: 'service' },
        ],
      };

      await mapSyncService.importMap('map-1', definition);

      expect(mockComponentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: 'fallback-name',
          name: 'fallback-name',
        }),
      );
    });

    it('should convert checks and actions from YAML format to config format', async () => {
      mockMapsRepo.findById.mockResolvedValue(baseMap);
      mockComponentsRepo.findByMap.mockResolvedValue([]);
      mockComponentsRepo.create.mockResolvedValue({} as any);
      mockMapsRepo.update.mockResolvedValue({} as any);

      const definition: MapYAML = {
        name: 'Production',
        components: [
          {
            id: 'api',
            name: 'api',
            type: 'service',
            checks: [
              {
                name: 'health',
                type: 'http',
                config: { url: 'http://localhost:8080/health' },
                interval_secs: 30,
                timeout_secs: 10,
              },
            ],
            actions: [
              {
                name: 'start',
                label: 'Start API',
                command: 'systemctl start api',
                args: ['--no-block'],
                run_as_user: 'app',
                async: true,
                confirmation_required: true,
              },
            ],
          },
        ],
      };

      await mapSyncService.importMap('map-1', definition);

      expect(mockComponentsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            checks: [
              {
                name: 'health',
                type: 'http',
                config: { url: 'http://localhost:8080/health' },
                intervalSecs: 30,
                timeoutSecs: 10,
              },
            ],
            actions: [
              {
                name: 'start',
                label: 'Start API',
                command: 'systemctl start api',
                args: ['--no-block'],
                runAsUser: 'app',
                async: true,
                confirmationRequired: true,
              },
            ],
          }),
        }),
      );
    });

    it('should throw when map is not found', async () => {
      mockMapsRepo.findById.mockResolvedValue(null);

      const definition: MapYAML = { name: 'Test', components: [] };

      await expect(
        mapSyncService.importMap('nonexistent', definition),
      ).rejects.toThrow('Map nonexistent not found');
    });
  });

  // ---------------------------------------------------------------------------
  // diff
  // ---------------------------------------------------------------------------
  describe('diff', () => {
    it('should identify added components', async () => {
      mockComponentsRepo.findByMap.mockResolvedValue([]);

      const newDef: MapYAML = {
        name: 'Map',
        components: [
          { id: 'web', name: 'web-server', type: 'service' },
          { id: 'db', name: 'database', type: 'database' },
        ],
      };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.added).toEqual(['web-server', 'database']);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it('should identify removed components', async () => {
      mockComponentsRepo.findByMap.mockResolvedValue([
        { id: 'comp-1', name: 'web-server', type: 'service', config: {} } as any,
        { id: 'comp-2', name: 'cache', type: 'cache', config: {} } as any,
      ]);

      const newDef: MapYAML = {
        name: 'Map',
        components: [],
      };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual(['web-server', 'cache']);
      expect(result.changed).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });

    it('should identify changed components', async () => {
      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'web-server',
          type: 'service',
          config: JSON.stringify({
            agentSelector: { agent_id: 'agent-1' },
            dependencies: undefined,
            checks: undefined,
            actions: undefined,
            metadata: undefined,
          }),
        } as any,
      ]);

      const newDef: MapYAML = {
        name: 'Map',
        components: [
          {
            id: 'web',
            name: 'web-server',
            type: 'service',
            agent_selector: { agent_id: 'agent-2' },
          },
        ],
      };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual(['web-server']);
      expect(result.unchanged).toEqual([]);
    });

    it('should identify unchanged components', async () => {
      // The diff compares JSON.stringify(existing.config) vs JSON.stringify(newConfig)
      // For them to be equal, the existing config in the DB must match the new definition's
      // config object shape exactly.
      const configObj = {
        agentSelector: { agent_id: 'agent-1' },
        dependencies: ['db'],
        checks: undefined,
        actions: undefined,
        metadata: undefined,
      };

      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'web-server',
          type: 'service',
          config: configObj,
        } as any,
      ]);

      const newDef: MapYAML = {
        name: 'Map',
        components: [
          {
            id: 'web',
            name: 'web-server',
            type: 'service',
            agent_selector: { agent_id: 'agent-1' },
            dependencies: ['db'],
          },
        ],
      };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.unchanged).toEqual(['web-server']);
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
    });

    it('should handle mixed added, removed, changed, and unchanged', async () => {
      const unchangedConfig = {
        agentSelector: { agent_id: 'agent-1' },
        dependencies: undefined,
        checks: undefined,
        actions: undefined,
        metadata: undefined,
      };

      mockComponentsRepo.findByMap.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'unchanged-comp',
          type: 'service',
          config: unchangedConfig,
        } as any,
        {
          id: 'comp-2',
          name: 'changed-comp',
          type: 'service',
          config: { agentSelector: { agent_id: 'old-agent' } },
        } as any,
        {
          id: 'comp-3',
          name: 'removed-comp',
          type: 'service',
          config: {},
        } as any,
      ]);

      const newDef: MapYAML = {
        name: 'Map',
        components: [
          {
            id: 'unch',
            name: 'unchanged-comp',
            type: 'service',
            agent_selector: { agent_id: 'agent-1' },
          },
          {
            id: 'chg',
            name: 'changed-comp',
            type: 'service',
            agent_selector: { agent_id: 'new-agent' },
          },
          {
            id: 'add',
            name: 'added-comp',
            type: 'queue',
          },
        ],
      };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.added).toEqual(['added-comp']);
      expect(result.removed).toEqual(['removed-comp']);
      expect(result.changed).toEqual(['changed-comp']);
      expect(result.unchanged).toEqual(['unchanged-comp']);
    });

    it('should return all empty arrays when both sides are empty', async () => {
      mockComponentsRepo.findByMap.mockResolvedValue([]);

      const newDef: MapYAML = { name: 'Map', components: [] };

      const result = await mapSyncService.diff('map-1', newDef);

      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.changed).toEqual([]);
      expect(result.unchanged).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // syncFromGit (early-exit paths only)
  // ---------------------------------------------------------------------------
  describe('syncFromGit', () => {
    it('should throw when map is not found', async () => {
      mockMapsRepo.findById.mockResolvedValue(null);

      await expect(mapSyncService.syncFromGit('nonexistent')).rejects.toThrow(
        'Map nonexistent not found',
      );
    });

    it('should return not synced when no gitRepoUrl is configured', async () => {
      mockMapsRepo.findById.mockResolvedValue({
        id: 'map-1',
        name: 'No Git',
        gitRepoUrl: null,
        gitBranch: 'main',
      } as any);

      const result = await mapSyncService.syncFromGit('map-1');

      expect(result.synced).toBe(false);
      expect(result.message).toBe(
        'No Git repository URL configured for this map',
      );
    });

    it('should return not synced when gitRepoUrl is empty string', async () => {
      mockMapsRepo.findById.mockResolvedValue({
        id: 'map-1',
        name: 'Empty Git URL',
        gitRepoUrl: '',
        gitBranch: 'main',
      } as any);

      const result = await mapSyncService.syncFromGit('map-1');

      expect(result.synced).toBe(false);
      expect(result.message).toBe(
        'No Git repository URL configured for this map',
      );
    });
  });
});
