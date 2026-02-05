import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../db/repositories/index.js', () => {
  return {
    jobsRepository: {
      create: vi.fn().mockResolvedValue({ id: 'job-1' }),
      findById: vi.fn().mockResolvedValue(null),
      markFailed: vi.fn().mockResolvedValue(undefined),
      markTimeout: vi.fn().mockResolvedValue(undefined),
    },
    componentsRepository: {
      findById: vi.fn().mockResolvedValue(null),
    },
  };
});

vi.mock('../gateway/manager.js', () => ({
  gatewayManager: {
    findAgentByLabels: vi.fn().mockReturnValue(undefined),
    isAgentOnline: vi.fn().mockReturnValue(false),
    sendCommand: vi.fn().mockResolvedValue({ sent: false, error: 'test' }),
    getConnectedAgents: vi.fn().mockReturnValue([]),
    sendToGateway: vi.fn().mockReturnValue(false),
  },
}));

import { commandOrchestrator, ExecutionMode } from './command-orchestrator.js';
import { componentsRepository, jobsRepository } from '../db/repositories/index.js';
import { gatewayManager } from '../gateway/manager.js';

describe('CommandOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    commandOrchestrator.shutdown();
  });

  describe('determineExecutionMode', () => {
    it('should return sync for native commands', () => {
      const mode = commandOrchestrator.determineExecutionMode('native.disk_space');
      expect(mode.type).toBe('sync');
    });

    it('should return sync for status command', () => {
      const mode = commandOrchestrator.determineExecutionMode('status');
      expect(mode.type).toBe('sync');
    });

    it('should return async for start command', () => {
      const mode = commandOrchestrator.determineExecutionMode('start');
      expect(mode.type).toBe('async');
      expect(mode.completion_check).toBeDefined();
    });

    it('should return async for stop command', () => {
      const mode = commandOrchestrator.determineExecutionMode('stop');
      expect(mode.type).toBe('async');
    });

    it('should return async for restart command', () => {
      const mode = commandOrchestrator.determineExecutionMode('restart');
      expect(mode.type).toBe('async');
    });

    it('should return sync for port.check', () => {
      const mode = commandOrchestrator.determineExecutionMode('port.check');
      expect(mode.type).toBe('sync');
    });

    it('should return sync for discovery commands', () => {
      const mode = commandOrchestrator.determineExecutionMode('discovery.services');
      expect(mode.type).toBe('sync');
    });

    it('should return async for action.* commands', () => {
      const mode = commandOrchestrator.determineExecutionMode('action.backup');
      expect(mode.type).toBe('async');
    });

    it('should return sync for unknown commands', () => {
      const mode = commandOrchestrator.determineExecutionMode('unknown_command');
      expect(mode.type).toBe('sync');
      expect(mode.timeout_ms).toBe(60000);
    });

    it('should use component config to infer completion check for start', () => {
      const mode = commandOrchestrator.determineExecutionMode('start', {
        checks: [
          { name: 'health', type: 'http', config: { url: 'http://localhost:8080/health', expectedStatus: 200 }, intervalSecs: 30, timeoutSecs: 10 },
          { name: 'port', type: 'tcp', config: { port: 8080, host: '127.0.0.1' }, intervalSecs: 30, timeoutSecs: 5 },
        ],
        actions: [{ name: 'start', label: 'Start', command: 'systemctl start app', async: true }],
      });

      expect(mode.type).toBe('async');
      expect(mode.completion_check).toBeDefined();
      expect(mode.completion_check!.type).toBe('all');
      expect(mode.completion_check!.checks).toHaveLength(2);
    });

    it('should use component config to infer completion check for stop', () => {
      const mode = commandOrchestrator.determineExecutionMode('stop', {
        checks: [
          { name: 'port', type: 'tcp', config: { port: 8080 }, intervalSecs: 30, timeoutSecs: 5 },
        ],
        actions: [{ name: 'stop', label: 'Stop', command: 'systemctl stop app', async: true }],
      });

      expect(mode.type).toBe('async');
      expect(mode.completion_check).toBeDefined();
      expect(mode.completion_check!.type).toBe('port_open');
      expect(mode.completion_check!.should_be_open).toBe(false);
    });

    it('should respect explicit async=false in component config', () => {
      const mode = commandOrchestrator.determineExecutionMode('start', {
        actions: [{ name: 'start', label: 'Start', command: 'quick-start.sh', async: false }],
      });

      expect(mode.type).toBe('sync');
    });
  });

  describe('executeCommand', () => {
    it('should return error when component not found', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue(null);

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Component not found');
    });

    it('should return error when action not found', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test-component',
        type: 'service',
        config: { actions: [] },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Action 'start' not defined");
    });

    it('should return error when no agent found', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test-component',
        type: 'service',
        config: {
          agentSelector: { labels: { role: 'db' } },
          actions: [{ name: 'start', label: 'Start', command: 'systemctl start app', async: true }],
        },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(gatewayManager.findAgentByLabels).mockReturnValue(undefined);

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No agent found for this component');
    });

    it('should return error when agent is offline', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test-component',
        type: 'service',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', label: 'Start', command: 'systemctl start app', async: true }],
        },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(false);

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent is offline');
    });

    it('should send command successfully', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test-component',
        type: 'service',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', label: 'Start', command: 'systemctl start app', async: true }],
        },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: true, gatewayId: 'gw-1' });

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-1');
      expect(result.mode).toBe('async');
    });

    it('should handle failed command send', async () => {
      vi.mocked(componentsRepository.findById).mockResolvedValue({
        id: 'comp-1',
        mapId: 'map-1',
        name: 'test-component',
        type: 'service',
        config: {
          agentSelector: { agentId: 'agent-1' },
          actions: [{ name: 'start', label: 'Start', command: 'systemctl start app', async: true }],
        },
        position: { x: 0, y: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(gatewayManager.isAgentOnline).mockReturnValue(true);
      vi.mocked(gatewayManager.sendCommand).mockResolvedValue({ sent: false, error: 'No gateway' });

      const result = await commandOrchestrator.executeCommand({
        mapId: 'map-1',
        componentId: 'comp-1',
        commandName: 'start',
        userId: 'user-1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No gateway');
      expect(jobsRepository.markFailed).toHaveBeenCalledWith('job-1', 'No gateway');
    });
  });

  describe('getActiveJobs', () => {
    it('should return empty array initially', () => {
      expect(commandOrchestrator.getActiveJobs()).toEqual([]);
    });
  });

  describe('cancelJob', () => {
    it('should return false for non-existent job', () => {
      expect(commandOrchestrator.cancelJob('nonexistent')).toBe(false);
    });
  });
});
