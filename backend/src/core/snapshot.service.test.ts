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
  componentsRepository: {
    findAll: vi.fn().mockResolvedValue([]),
    findByMap: vi.fn().mockResolvedValue([]),
  },
  agentsRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('../gateway/manager.js', () => ({
  gatewayManager: {
    getConnectedAgents: vi.fn().mockReturnValue([]),
    sendToGateway: vi.fn().mockReturnValue(true),
  },
}));

import { snapshotService } from './snapshot.service.js';
import { componentsRepository, agentsRepository } from '../db/repositories/index.js';
import { gatewayManager } from '../gateway/manager.js';

const mockAgentsRepo = vi.mocked(agentsRepository);
const mockComponentsRepo = vi.mocked(componentsRepository);

describe('SnapshotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildSnapshotForAgent', () => {
    it('should throw when agent not found', async () => {
      mockAgentsRepo.findById.mockResolvedValue(null);

      await expect(snapshotService.buildSnapshotForAgent('agent-1'))
        .rejects.toThrow('Agent agent-1 not found');
    });

    it('should return empty components when no matching components', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-01',
        labels: { role: 'web' },
      });
      mockComponentsRepo.findAll.mockResolvedValue([]);

      const snapshot = await snapshotService.buildSnapshotForAgent('agent-1');

      expect(snapshot.agent_id).toBe('agent-1');
      expect(snapshot.snapshot.components).toEqual([]);
    });

    it('should match components by agentId', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-01',
        labels: {},
      });
      mockComponentsRepo.findAll.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'trading-api',
          type: 'service',
          config: {
            agentSelector: { agentId: 'agent-1' },
            checks: [
              { name: 'health', type: 'http', config: { url: 'http://localhost:8080/health' }, intervalSecs: 30, timeoutSecs: 10 },
            ],
            actions: [
              { name: 'start', label: 'Start', command: 'systemctl start trading-api', args: [], async: true },
              { name: 'stop', label: 'Stop', command: 'systemctl stop trading-api', args: [], async: true },
            ],
          },
        },
        {
          id: 'comp-2',
          name: 'redis',
          type: 'service',
          config: {
            agentSelector: { agentId: 'agent-2' }, // Different agent
            checks: [],
            actions: [],
          },
        },
      ]);

      const snapshot = await snapshotService.buildSnapshotForAgent('agent-1');

      expect(snapshot.snapshot.components).toHaveLength(1);
      expect(snapshot.snapshot.components[0].external_id).toBe('trading-api');
      expect(snapshot.snapshot.components[0].checks).toHaveLength(1);
      expect(snapshot.snapshot.components[0].actions).toHaveLength(2);
    });

    it('should match components by labels', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-db-01',
        labels: { role: 'database', env: 'production' },
      });
      mockComponentsRepo.findAll.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'postgresql',
          type: 'service',
          config: {
            agentSelector: { labels: { role: 'database', env: 'production' } },
            checks: [],
            actions: [{ name: 'backup', label: 'Backup', command: '/opt/scripts/backup.sh', args: [], async: true }],
          },
        },
        {
          id: 'comp-2',
          name: 'nginx',
          type: 'service',
          config: {
            agentSelector: { labels: { role: 'web' } }, // Non-matching label
            checks: [],
            actions: [],
          },
        },
      ]);

      const snapshot = await snapshotService.buildSnapshotForAgent('agent-1');

      expect(snapshot.snapshot.components).toHaveLength(1);
      expect(snapshot.snapshot.components[0].external_id).toBe('postgresql');
    });

    it('should not match partial label matches', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-01',
        labels: { role: 'database' }, // Missing 'env' label
      });
      mockComponentsRepo.findAll.mockResolvedValue([
        {
          id: 'comp-1',
          name: 'postgresql',
          type: 'service',
          config: {
            agentSelector: { labels: { role: 'database', env: 'production' } },
            checks: [],
            actions: [],
          },
        },
      ]);

      const snapshot = await snapshotService.buildSnapshotForAgent('agent-1');
      expect(snapshot.snapshot.components).toHaveLength(0);
    });
  });

  describe('buildSnapshotComponent', () => {
    it('should convert component to snapshot format', () => {
      const component = {
        id: 'comp-1',
        mapId: 'map-1',
        name: 'trading-api',
        type: 'service',
        config: {
          checks: [
            { name: 'health', type: 'http' as const, config: { url: 'http://localhost:8080/health' }, intervalSecs: 30, timeoutSecs: 10 },
          ],
          actions: [
            { name: 'start', label: 'Start', command: 'systemctl start app', args: ['--flag'], runAsUser: 'app', async: true },
          ],
        },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const snapshot = snapshotService.buildSnapshotComponent(component);

      expect(snapshot.id).toBe('comp-1');
      expect(snapshot.external_id).toBe('trading-api');
      expect(snapshot.checks[0].name).toBe('health');
      expect(snapshot.checks[0].interval_secs).toBe(30);
      expect(snapshot.actions[0].name).toBe('start');
      expect(snapshot.actions[0].command).toBe('systemctl start app');
      expect(snapshot.actions[0].run_as_user).toBe('app');
      expect(snapshot.actions[0].async).toBe(true);
      expect(snapshot.actions[0].timeout_secs).toBe(300); // async default
    });

    it('should handle empty checks and actions', () => {
      const component = {
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test',
        type: 'service',
        config: {},
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const snapshot = snapshotService.buildSnapshotComponent(component);

      expect(snapshot.checks).toEqual([]);
      expect(snapshot.actions).toEqual([]);
    });
  });

  describe('sendSnapshotToAgent', () => {
    it('should return false when agent not connected', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-01',
        labels: {},
      });
      mockComponentsRepo.findAll.mockResolvedValue([]);
      vi.mocked(gatewayManager.getConnectedAgents).mockReturnValue([]);

      const result = await snapshotService.sendSnapshotToAgent('agent-1');
      expect(result).toBe(false);
    });

    it('should send snapshot to connected agent', async () => {
      mockAgentsRepo.findById.mockResolvedValue({
        id: 'agent-1',
        hostname: 'srv-01',
        labels: {},
      });
      mockComponentsRepo.findAll.mockResolvedValue([]);
      vi.mocked(gatewayManager.getConnectedAgents).mockReturnValue([
        { id: 'agent-1', hostname: 'srv-01', gatewayId: 'gw-1' },
      ]);
      vi.mocked(gatewayManager.sendToGateway).mockReturnValue(true);

      const result = await snapshotService.sendSnapshotToAgent('agent-1');

      expect(result).toBe(true);
      expect(gatewayManager.sendToGateway).toHaveBeenCalledWith('gw-1', {
        type: 'snapshot',
        payload: expect.objectContaining({ agent_id: 'agent-1' }),
      });
    });
  });

  describe('sendSnapshotsToAllAgents', () => {
    it('should return counts for all agents', async () => {
      vi.mocked(gatewayManager.getConnectedAgents).mockReturnValue([]);

      const result = await snapshotService.sendSnapshotsToAllAgents();

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
