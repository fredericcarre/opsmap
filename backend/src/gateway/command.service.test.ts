import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  config: {
    logging: { level: 'silent' },
    nodeEnv: 'test',
  },
}));

vi.mock('../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../db/repositories/index.js', () => ({
  componentsRepository: {
    findById: vi.fn(),
  },
  jobsRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock('./manager.js', () => ({
  gatewayManager: {
    isAgentOnline: vi.fn(),
    findAgentByLabels: vi.fn(),
    sendCommand: vi.fn(),
  },
}));

import { commandService } from './command.service.js';
import { componentsRepository, jobsRepository } from '../db/repositories/index.js';
import { gatewayManager } from './manager.js';

describe('commandService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeComponentCommand', () => {
    const baseParams = {
      mapId: 'map-1',
      componentId: 'comp-1',
      commandName: 'start',
      userId: 'user-1',
    };

    it('should return error if component not found', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue(null as any);

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Component not found');
    });

    it('should return error if action not defined', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: { actions: [] },
      } as any);

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action 'start' not defined");
    });

    it('should return error if no agent selector', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          actions: [{ name: 'start', command: '/usr/bin/start.sh' }],
        },
      } as any);

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No agent selector defined for this component');
    });

    it('should return error if agent is offline', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', command: '/usr/bin/start.sh' }],
        },
      } as any);
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(false);

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent is offline');
    });

    it('should send command and return jobId on success', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', command: '/usr/bin/start.sh', args: ['--force'] }],
        },
      } as any);
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-1' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: true, gatewayId: 'gw-1' });

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-1');
      expect(result.message).toContain('start');
    });

    it('should handle failed command send', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', command: '/usr/bin/start.sh' }],
        },
      } as any);
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-1' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: false, error: 'Gateway down' });

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Gateway down');
      expect(result.jobId).toBe('job-1');
      expect(jobsRepository.markFailed).toHaveBeenCalled();
    });

    it('should handle custom actions', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'deploy', command: '/usr/bin/deploy.sh' }],
        },
      } as any);
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-2' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: true, gatewayId: 'gw-1' });

      const result = await commandService.executeComponentCommand({
        ...baseParams,
        commandName: 'deploy',
      });

      expect(result.success).toBe(true);
    });

    it('should use labels-based agent selector', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        config: {
          agentSelector: { labels: { role: 'web' } },
          actions: [{ name: 'start', command: '/usr/bin/start.sh' }],
        },
      } as any);
      vi.mocked(gatewayManager.findAgentByLabels).mockReturnValue({ id: 'agent-2' } as any);
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-3' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: true, gatewayId: 'gw-1' });

      const result = await commandService.executeComponentCommand(baseParams);

      expect(result.success).toBe(true);
      expect(gatewayManager.findAgentByLabels).toHaveBeenCalledWith({ role: 'web' });
    });
  });

  describe('executeNativeCommand', () => {
    it('should return error if agent is offline', async () => {
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(false);

      const result = await commandService.executeNativeCommand('agent-1', 'disk_space', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent is offline');
    });

    it('should send native command successfully', async () => {
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-4' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: true, gatewayId: 'gw-1' });

      const result = await commandService.executeNativeCommand(
        'agent-1',
        'disk_space',
        { path: '/' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-4');
    });

    it('should handle failed native command send', async () => {
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(jobsRepository.create).mockResolvedValue({ id: 'job-5' } as any);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: false, error: 'Connection lost' });

      const result = await commandService.executeNativeCommand(
        'agent-1',
        'disk_space',
        {},
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(jobsRepository.markFailed).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('should return job from repository', async () => {
      const mockJob = { id: 'job-1', status: 'completed' };
      vi.mocked(jobsRepository.findById).mockResolvedValue(mockJob as any);

      const result = await commandService.getJobStatus('job-1');

      expect(result).toEqual(mockJob);
    });

    it('should return null for unknown job', async () => {
      vi.mocked(jobsRepository.findById).mockResolvedValue(null);

      const result = await commandService.getJobStatus('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('waitForJobCompletion', () => {
    it('should return completed job immediately', async () => {
      const mockJob = { id: 'job-1', status: 'completed' };
      vi.mocked(jobsRepository.findById).mockResolvedValue(mockJob as any);

      const result = await commandService.waitForJobCompletion('job-1', 1000);

      expect(result).toEqual(mockJob);
    });

    it('should return null for unknown job', async () => {
      vi.mocked(jobsRepository.findById).mockResolvedValue(null);

      const result = await commandService.waitForJobCompletion('nonexistent', 1000);

      expect(result).toBeNull();
    });

    it('should return failed job immediately', async () => {
      const mockJob = { id: 'job-1', status: 'failed' };
      vi.mocked(jobsRepository.findById).mockResolvedValue(mockJob as any);

      const result = await commandService.waitForJobCompletion('job-1', 1000);

      expect(result).toEqual(mockJob);
    });
  });
});
