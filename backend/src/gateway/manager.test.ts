import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
  gatewaysRepository: {
    upsert: vi.fn().mockResolvedValue(undefined),
    updateAgentCount: vi.fn().mockResolvedValue(undefined),
    markOffline: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
  },
  agentsRepository: {
    upsert: vi.fn().mockResolvedValue(undefined),
    markOffline: vi.fn().mockResolvedValue(undefined),
    markAllOfflineByGateway: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
  },
  jobsRepository: {
    findById: vi.fn().mockResolvedValue(null),
    markStarted: vi.fn().mockResolvedValue(undefined),
    markCompleted: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markTimeout: vi.fn().mockResolvedValue(undefined),
  },
}));

import { gatewayManager } from './manager.js';
import { gatewaysRepository, agentsRepository, jobsRepository } from '../db/repositories/index.js';
import WebSocket from 'ws';

const mockGatewaysRepo = vi.mocked(gatewaysRepository);
const mockAgentsRepo = vi.mocked(agentsRepository);
const mockJobsRepo = vi.mocked(jobsRepository);

// Helper to create a mock WebSocket
function createMockWs(): EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; readyState: number } {
  const ws = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; readyState: number };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = WebSocket.OPEN;
  return ws;
}

// Helper to simulate a gateway register
async function registerGateway(ws: ReturnType<typeof createMockWs>, gatewayId: string, agents: Array<{ id: string; hostname: string; labels: Record<string, string>; version: string; os: string; connected_at: string; last_heartbeat: string }> = []) {
  const messageHandler = getMessageHandler(ws);
  const registerMsg = JSON.stringify({
    type: 'register',
    payload: {
      gateway_id: gatewayId,
      zone: 'test-zone',
      version: '1.0.0',
      agents,
    },
  });
  await messageHandler(registerMsg);
}

function getMessageHandler(ws: ReturnType<typeof createMockWs>): (data: string) => Promise<void> {
  // Get the 'message' listener that was registered by handleConnection
  const listeners = ws.listeners('message');
  return listeners[0] as (data: string) => Promise<void>;
}

describe('GatewayManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up: stop the manager to clear intervals
    gatewayManager.stop();
  });

  describe('start and stop', () => {
    it('should start and stop without errors', () => {
      gatewayManager.start();
      gatewayManager.stop();
    });

    it('should stop even if not started', () => {
      gatewayManager.stop();
    });
  });

  describe('getConnectedGateways', () => {
    it('should return empty array when no gateways connected', () => {
      expect(gatewayManager.getConnectedGateways()).toEqual([]);
    });
  });

  describe('getConnectedAgents', () => {
    it('should return empty array when no agents connected', () => {
      expect(gatewayManager.getConnectedAgents()).toEqual([]);
    });
  });

  describe('isAgentOnline', () => {
    it('should return false for unknown agent', () => {
      expect(gatewayManager.isAgentOnline('nonexistent-agent')).toBe(false);
    });
  });

  describe('findAgentByLabels', () => {
    it('should return undefined when no agents match', () => {
      expect(gatewayManager.findAgentByLabels({ role: 'database' })).toBeUndefined();
    });
  });

  describe('sendToGateway', () => {
    it('should return false for unknown gateway', () => {
      expect(gatewayManager.sendToGateway('unknown', { type: 'ping' })).toBe(false);
    });
  });

  describe('sendCommand', () => {
    it('should return error when no gateway found for agent', async () => {
      mockAgentsRepo.findById.mockResolvedValue(null);
      const result = await gatewayManager.sendCommand(
        'job-1',
        'agent-1',
        undefined,
        { id: 'cmd-1', command_type: 'sync', name: 'disk_space', args: {}, timeout_secs: 60 }
      );
      expect(result.sent).toBe(false);
      expect(result.error).toBe('No gateway found for agent');
    });

    it('should broadcast to all gateways when using labels', async () => {
      const result = await gatewayManager.sendCommand(
        'job-1',
        undefined,
        { role: 'database' },
        { id: 'cmd-1', command_type: 'sync', name: 'disk_space', args: {}, timeout_secs: 60 }
      );
      expect(result.gatewayId).toBe('broadcast');
    });
  });

  describe('handleConnection', () => {
    it('should register a gateway on register message', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);

      await registerGateway(ws, 'gw-1');

      expect(mockGatewaysRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'gw-1', zone: 'test-zone' })
      );
      expect(gatewayManager.getConnectedGateways()).toEqual([
        { id: 'gw-1', zone: 'test-zone', agentCount: 0 },
      ]);
    });

    it('should register agents provided during gateway registration', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);

      const agents = [
        { id: 'agent-1', hostname: 'host1', labels: { role: 'web' }, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-2', agents);

      expect(mockAgentsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-1', gatewayId: 'gw-2' })
      );
      expect(gatewayManager.isAgentOnline('agent-1')).toBe(true);
      expect(gatewayManager.getConnectedAgents()).toEqual([
        { id: 'agent-1', hostname: 'host1', gatewayId: 'gw-2' },
      ]);
    });

    it('should handle agent_connected message', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-3');

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'agent_connected',
        payload: { id: 'agent-2', hostname: 'host2', labels: { role: 'db' }, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      }));

      expect(mockAgentsRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-2', gatewayId: 'gw-3' })
      );
      expect(gatewayManager.isAgentOnline('agent-2')).toBe(true);
    });

    it('should handle agent_disconnected message', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      const agents = [
        { id: 'agent-3', hostname: 'host3', labels: {}, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-4', agents);

      expect(gatewayManager.isAgentOnline('agent-3')).toBe(true);

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'agent_disconnected',
        payload: { agent_id: 'agent-3' },
      }));

      expect(mockAgentsRepo.markOffline).toHaveBeenCalledWith('agent-3');
      expect(gatewayManager.isAgentOnline('agent-3')).toBe(false);
    });

    it('should handle status_update message', async () => {
      const ws = createMockWs();
      const emitSpy = vi.spyOn(gatewayManager, 'emit');
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-5');

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'status_update',
        payload: { agent_id: 'agent-1', status: 'ok', timestamp: new Date().toISOString() },
      }));

      expect(emitSpy).toHaveBeenCalledWith('status:update', expect.objectContaining({ agent_id: 'agent-1' }));
      emitSpy.mockRestore();
    });

    it('should handle command_response with started status', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-6');

      mockJobsRepo.findById.mockResolvedValue({ id: 'job-1', status: 'pending' });

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'command_response',
        payload: { job_id: 'job-1', agent_id: 'agent-1', status: 'started', timestamp: new Date().toISOString() },
      }));

      expect(mockJobsRepo.markStarted).toHaveBeenCalledWith('job-1');
    });

    it('should handle command_response with completed status', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-7');

      mockJobsRepo.findById.mockResolvedValue({ id: 'job-2', status: 'started' });

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'command_response',
        payload: {
          job_id: 'job-2',
          agent_id: 'agent-1',
          status: 'completed',
          result: { exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100, timed_out: false },
          timestamp: new Date().toISOString(),
        },
      }));

      expect(mockJobsRepo.markCompleted).toHaveBeenCalledWith('job-2', {
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 100,
        timedOut: false,
      });
    });

    it('should handle command_response with failed status', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-8');

      mockJobsRepo.findById.mockResolvedValue({ id: 'job-3', status: 'started' });

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'command_response',
        payload: { job_id: 'job-3', agent_id: 'agent-1', status: 'failed', error: 'Process crashed', timestamp: new Date().toISOString() },
      }));

      expect(mockJobsRepo.markFailed).toHaveBeenCalledWith('job-3', 'Process crashed');
    });

    it('should handle command_response with timeout status', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-9');

      mockJobsRepo.findById.mockResolvedValue({ id: 'job-4', status: 'started' });

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'command_response',
        payload: { job_id: 'job-4', agent_id: 'agent-1', status: 'timeout', timestamp: new Date().toISOString() },
      }));

      expect(mockJobsRepo.markTimeout).toHaveBeenCalledWith('job-4');
    });

    it('should skip command_response if job not found', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-10');

      mockJobsRepo.findById.mockResolvedValue(null);

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({
        type: 'command_response',
        payload: { job_id: 'missing-job', agent_id: 'agent-1', status: 'completed', timestamp: new Date().toISOString() },
      }));

      expect(mockJobsRepo.markCompleted).not.toHaveBeenCalled();
    });

    it('should handle pong message', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-11');

      const messageHandler = getMessageHandler(ws);
      await messageHandler(JSON.stringify({ type: 'pong' }));

      // No error thrown, heartbeat updated internally
      const gateways = gatewayManager.getConnectedGateways();
      expect(gateways.find(g => g.id === 'gw-11')).toBeDefined();
    });

    it('should handle gateway disconnect', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      const agents = [
        { id: 'agent-dc', hostname: 'h1', labels: {}, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-dc', agents);

      expect(gatewayManager.getConnectedGateways().find(g => g.id === 'gw-dc')).toBeDefined();

      // Simulate close
      ws.emit('close');
      // Allow async to complete
      await new Promise(r => setTimeout(r, 10));

      expect(mockAgentsRepo.markOffline).toHaveBeenCalledWith('agent-dc');
      expect(mockGatewaysRepo.markOffline).toHaveBeenCalledWith('gw-dc');
    });

    it('should handle malformed messages gracefully', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);

      const messageHandler = getMessageHandler(ws);
      // Should not throw
      await messageHandler('not-json');
    });

    it('should ignore agent messages before registration', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);

      const messageHandler = getMessageHandler(ws);
      // Send agent_connected without registering first
      await messageHandler(JSON.stringify({
        type: 'agent_connected',
        payload: { id: 'agent-x', hostname: 'h', labels: {}, version: '1', os: 'linux', connected_at: '', last_heartbeat: '' },
      }));

      // Should not have called upsert for unregistered gateway
      expect(mockAgentsRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('sendCommand with registered gateway', () => {
    it('should send command to gateway where agent is connected', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      const agents = [
        { id: 'agent-sc', hostname: 'h1', labels: {}, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-sc', agents);

      const result = await gatewayManager.sendCommand(
        'job-sc',
        'agent-sc',
        undefined,
        { id: 'cmd-sc', command_type: 'sync', name: 'disk_space', args: {}, timeout_secs: 60 }
      );

      expect(result.sent).toBe(true);
      expect(result.gatewayId).toBe('gw-sc');
      expect(ws.send).toHaveBeenCalled();
    });

    it('should lookup agent in database if not found in memory', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-lookup');

      // Agent not in memory but found in DB with matching gatewayId
      mockAgentsRepo.findById.mockResolvedValue({ id: 'agent-db', gatewayId: 'gw-lookup' });

      const result = await gatewayManager.sendCommand(
        'job-db',
        'agent-db',
        undefined,
        { id: 'cmd-db', command_type: 'sync', name: 'disk_space', args: {}, timeout_secs: 60 }
      );

      expect(result.sent).toBe(true);
      expect(result.gatewayId).toBe('gw-lookup');
    });

    it('should broadcast to connected gateways when using labels', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-bc');

      const result = await gatewayManager.sendCommand(
        'job-bc',
        undefined,
        { role: 'web' },
        { id: 'cmd-bc', command_type: 'sync', name: 'status', args: {}, timeout_secs: 30 }
      );

      expect(result.sent).toBe(true);
      expect(result.gatewayId).toBe('broadcast');
      expect(ws.send).toHaveBeenCalled();
    });
  });

  describe('findAgentByLabels with agents', () => {
    it('should find agent matching all labels', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      const agents = [
        { id: 'agent-lbl', hostname: 'h1', labels: { role: 'web', env: 'prod' }, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-lbl', agents);

      const result = gatewayManager.findAgentByLabels({ role: 'web', env: 'prod' });
      expect(result).toBeDefined();
      expect(result!.id).toBe('agent-lbl');
    });

    it('should return undefined if labels do not fully match', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      const agents = [
        { id: 'agent-lbl2', hostname: 'h1', labels: { role: 'web' }, version: '1.0', os: 'linux', connected_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() },
      ];
      await registerGateway(ws, 'gw-lbl2', agents);

      const result = gatewayManager.findAgentByLabels({ role: 'web', env: 'prod' });
      expect(result).toBeUndefined();
    });
  });

  describe('sendToGateway with registered gateway', () => {
    it('should send message when gateway is connected and open', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-send');

      const result = gatewayManager.sendToGateway('gw-send', { type: 'ping' });
      expect(result).toBe(true);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    });

    it('should return false if ws is not open', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-closed');

      ws.readyState = WebSocket.CLOSED;
      const result = gatewayManager.sendToGateway('gw-closed', { type: 'ping' });
      expect(result).toBe(false);
    });

    it('should return false if send throws', async () => {
      const ws = createMockWs();
      gatewayManager.handleConnection(ws as any);
      await registerGateway(ws, 'gw-err');

      ws.send.mockImplementation(() => { throw new Error('send failed'); });
      const result = gatewayManager.sendToGateway('gw-err', { type: 'ping' });
      expect(result).toBe(false);
    });
  });
});
