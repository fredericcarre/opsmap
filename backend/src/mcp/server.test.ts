import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../db/repositories/index.js', () => ({
  mapsRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  },
  componentsRepository: {
    findByMap: vi.fn(),
    findById: vi.fn(),
  },
  checkResultsRepository: {
    getMapStatus: vi.fn(),
    getComponentStatus: vi.fn(),
    findByComponentAndCheck: vi.fn(),
    findByComponent: vi.fn(),
  },
  agentsRepository: {
    findAll: vi.fn(),
  },
  gatewaysRepository: {
    findAll: vi.fn(),
  },
  jobsRepository: {
    findByComponent: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../gateway/index.js', () => ({
  commandService: {
    executeComponentCommand: vi.fn(),
  },
}));

import { mcpServer } from './server.js';
import type { MCPRequest } from './server.js';
import {
  mapsRepository,
  componentsRepository,
  checkResultsRepository,
  agentsRepository,
  gatewaysRepository,
  jobsRepository,
} from '../db/repositories/index.js';
import { commandService } from '../gateway/index.js';

const mockMapsRepo = vi.mocked(mapsRepository);
const mockComponentsRepo = vi.mocked(componentsRepository);
const mockCheckResultsRepo = vi.mocked(checkResultsRepository);
const mockAgentsRepo = vi.mocked(agentsRepository);
const mockGatewaysRepo = vi.mocked(gatewaysRepository);
const mockJobsRepo = vi.mocked(jobsRepository);
const mockCommandService = vi.mocked(commandService);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCPServer', () => {
  describe('tools/list', () => {
    it('returns all 7 tools with names and schemas', async () => {
      const request: MCPRequest = { method: 'tools/list' };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = response.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
      expect(result.tools).toHaveLength(7);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toEqual([
        'list_maps',
        'get_map_status',
        'get_component_details',
        'execute_action',
        'list_agents',
        'get_check_history',
        'get_job_status',
      ]);

      for (const tool of result.tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema).toHaveProperty('type', 'object');
        expect(tool.inputSchema).toHaveProperty('properties');
        expect(tool.inputSchema).toHaveProperty('required');
      }
    });

    it('includes required fields in inputSchema for get_map_status', async () => {
      const response = await mcpServer.handleRequest({ method: 'tools/list' });
      const result = response.result as { tools: Array<{ name: string; inputSchema: { required: string[] } }> };
      const getMapStatus = result.tools.find((t) => t.name === 'get_map_status');

      expect(getMapStatus).toBeDefined();
      expect(getMapStatus!.inputSchema.required).toContain('mapId');
    });

    it('includes required fields in inputSchema for execute_action', async () => {
      const response = await mcpServer.handleRequest({ method: 'tools/list' });
      const result = response.result as { tools: Array<{ name: string; inputSchema: { required: string[] } }> };
      const executeAction = result.tools.find((t) => t.name === 'execute_action');

      expect(executeAction).toBeDefined();
      expect(executeAction!.inputSchema.required).toEqual(
        expect.arrayContaining(['mapId', 'componentId', 'action', 'userId'])
      );
    });
  });

  describe('tools/call - list_maps', () => {
    it('returns maps with component counts', async () => {
      const maps = [
        { id: 'map-1', name: 'Production', description: 'Prod env', updatedAt: '2025-01-01T00:00:00Z' },
        { id: 'map-2', name: 'Staging', description: 'Stage env', updatedAt: '2025-01-02T00:00:00Z' },
      ];
      mockMapsRepo.findAll.mockResolvedValue(maps as any);
      mockComponentsRepo.findByMap.mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }] as any);
      mockComponentsRepo.findByMap.mockResolvedValueOnce([{ id: 'c3' }] as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'list_maps', arguments: {} },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.maps).toHaveLength(2);
      expect(result.maps[0]).toEqual({
        id: 'map-1',
        name: 'Production',
        description: 'Prod env',
        componentCount: 2,
        updatedAt: '2025-01-01T00:00:00Z',
      });
      expect(result.maps[1].componentCount).toBe(1);

      expect(mockMapsRepo.findAll).toHaveBeenCalledOnce();
      expect(mockComponentsRepo.findByMap).toHaveBeenCalledTimes(2);
      expect(mockComponentsRepo.findByMap).toHaveBeenCalledWith('map-1');
      expect(mockComponentsRepo.findByMap).toHaveBeenCalledWith('map-2');
    });
  });

  describe('tools/call - get_map_status', () => {
    it('returns map status with components', async () => {
      const map = { id: 'map-1', name: 'Production' };
      const componentStatuses = [
        { componentId: 'c1', status: 'ok' },
        { componentId: 'c2', status: 'error' },
      ];
      mockMapsRepo.findById.mockResolvedValue(map as any);
      mockCheckResultsRepo.getMapStatus.mockResolvedValue(componentStatuses as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_map_status', arguments: { mapId: 'map-1' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.map).toEqual({ id: 'map-1', name: 'Production' });
      expect(result.components).toEqual(componentStatuses);

      expect(mockMapsRepo.findById).toHaveBeenCalledWith('map-1');
      expect(mockCheckResultsRepo.getMapStatus).toHaveBeenCalledWith('map-1');
    });

    it('returns error when map is not found', async () => {
      mockMapsRepo.findById.mockResolvedValue(null as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_map_status', arguments: { mapId: 'nonexistent' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32000);
      expect(response.error!.message).toBe('Map nonexistent not found');
    });
  });

  describe('tools/call - get_component_details', () => {
    it('returns component details with status and recent jobs', async () => {
      const component = {
        id: 'c1',
        name: 'web-server',
        type: 'process',
        config: { binary: '/usr/bin/nginx' },
      };
      const status = {
        status: 'ok',
        checks: [{ name: 'http_check', status: 'ok', lastRun: '2025-01-01T00:00:00Z' }],
      };
      const recentJobs = [
        {
          id: 'j1',
          command: 'restart',
          status: 'completed',
          createdAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T00:01:00Z',
          extra: 'field-should-be-excluded',
        },
      ];

      mockComponentsRepo.findById.mockResolvedValue(component as any);
      mockCheckResultsRepo.getComponentStatus.mockResolvedValue(status as any);
      mockJobsRepo.findByComponent.mockResolvedValue(recentJobs as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_component_details', arguments: { componentId: 'c1' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.component).toEqual({
        id: 'c1',
        name: 'web-server',
        type: 'process',
        config: { binary: '/usr/bin/nginx' },
      });
      expect(result.status).toBe('ok');
      expect(result.checks).toEqual(status.checks);
      expect(result.recentJobs).toEqual([
        {
          id: 'j1',
          command: 'restart',
          status: 'completed',
          createdAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T00:01:00Z',
        },
      ]);
      // The extra field should not appear in the response
      expect(result.recentJobs[0]).not.toHaveProperty('extra');

      expect(mockComponentsRepo.findById).toHaveBeenCalledWith('c1');
      expect(mockCheckResultsRepo.getComponentStatus).toHaveBeenCalledWith('c1');
      expect(mockJobsRepo.findByComponent).toHaveBeenCalledWith('c1', 5);
    });

    it('returns error when component is not found', async () => {
      mockComponentsRepo.findById.mockResolvedValue(null as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_component_details', arguments: { componentId: 'missing' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32000);
      expect(response.error!.message).toBe('Component missing not found');
    });
  });

  describe('tools/call - execute_action', () => {
    it('executes a component command and returns result', async () => {
      const commandResult = { jobId: 'j-42', status: 'queued' };
      mockCommandService.executeComponentCommand.mockResolvedValue(commandResult as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: {
          name: 'execute_action',
          arguments: {
            mapId: 'map-1',
            componentId: 'c1',
            action: 'restart',
            userId: 'user-1',
          },
        },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result).toEqual(commandResult);

      expect(mockCommandService.executeComponentCommand).toHaveBeenCalledWith({
        mapId: 'map-1',
        componentId: 'c1',
        commandName: 'restart',
        userId: 'user-1',
      });
    });
  });

  describe('tools/call - list_agents', () => {
    it('returns agents enriched with gateway info', async () => {
      const agents = [
        {
          id: 'agent-1',
          hostname: 'server-01',
          labels: { role: 'database' },
          status: 'connected',
          version: '1.0.0',
          os: 'linux',
          gatewayId: 'gw-1',
          lastHeartbeat: '2025-01-01T00:00:00Z',
        },
        {
          id: 'agent-2',
          hostname: 'server-02',
          labels: { role: 'web' },
          status: 'disconnected',
          version: '1.0.0',
          os: 'linux',
          gatewayId: null,
          lastHeartbeat: '2025-01-01T00:00:00Z',
        },
      ];
      const gateways = [
        { id: 'gw-1', name: 'gateway-prod', zone: 'production' },
      ];

      mockAgentsRepo.findAll.mockResolvedValue(agents as any);
      mockGatewaysRepo.findAll.mockResolvedValue(gateways as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'list_agents', arguments: {} },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.agents).toHaveLength(2);

      // Agent with gateway
      expect(result.agents[0]).toEqual({
        id: 'agent-1',
        hostname: 'server-01',
        labels: { role: 'database' },
        status: 'connected',
        version: '1.0.0',
        os: 'linux',
        gateway: 'gateway-prod',
        zone: 'production',
        lastHeartbeat: '2025-01-01T00:00:00Z',
      });

      // Agent without gateway
      expect(result.agents[1].gateway).toBeNull();
      expect(result.agents[1].zone).toBeNull();

      expect(mockAgentsRepo.findAll).toHaveBeenCalledOnce();
      expect(mockGatewaysRepo.findAll).toHaveBeenCalledOnce();
    });
  });

  describe('tools/call - get_check_history', () => {
    it('returns check results filtered by checkName when provided', async () => {
      const results = [
        { id: 'r1', status: 'ok', timestamp: '2025-01-01T00:00:00Z' },
        { id: 'r2', status: 'error', timestamp: '2025-01-01T00:01:00Z' },
      ];
      mockCheckResultsRepo.findByComponentAndCheck.mockResolvedValue(results as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: {
          name: 'get_check_history',
          arguments: { componentId: 'c1', checkName: 'http_check', limit: 10 },
        },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.results).toEqual(results);

      expect(mockCheckResultsRepo.findByComponentAndCheck).toHaveBeenCalledWith('c1', 'http_check', 10);
      expect(mockCheckResultsRepo.findByComponent).not.toHaveBeenCalled();
    });

    it('returns all check results when checkName is not provided', async () => {
      const results = [
        { id: 'r1', status: 'ok', timestamp: '2025-01-01T00:00:00Z' },
      ];
      mockCheckResultsRepo.findByComponent.mockResolvedValue(results as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: {
          name: 'get_check_history',
          arguments: { componentId: 'c1' },
        },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.results).toEqual(results);

      expect(mockCheckResultsRepo.findByComponent).toHaveBeenCalledWith('c1', 50);
      expect(mockCheckResultsRepo.findByComponentAndCheck).not.toHaveBeenCalled();
    });

    it('uses default limit of 50 when not specified', async () => {
      mockCheckResultsRepo.findByComponent.mockResolvedValue([] as any);

      await mcpServer.handleRequest({
        method: 'tools/call',
        params: {
          name: 'get_check_history',
          arguments: { componentId: 'c1' },
        },
      });

      expect(mockCheckResultsRepo.findByComponent).toHaveBeenCalledWith('c1', 50);
    });
  });

  describe('tools/call - get_job_status', () => {
    it('returns job details when job exists', async () => {
      const job = {
        id: 'j1',
        command: 'restart',
        status: 'completed',
        result: { exitCode: 0 },
        createdAt: '2025-01-01T00:00:00Z',
        completedAt: '2025-01-01T00:01:00Z',
      };
      mockJobsRepo.findById.mockResolvedValue(job as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_job_status', arguments: { jobId: 'j1' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeUndefined();
      const result = JSON.parse((response.result as any).content[0].text);
      expect(result.job).toEqual(job);

      expect(mockJobsRepo.findById).toHaveBeenCalledWith('j1');
    });

    it('returns error when job is not found', async () => {
      mockJobsRepo.findById.mockResolvedValue(null as any);

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'get_job_status', arguments: { jobId: 'nonexistent' } },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32000);
      expect(response.error!.message).toBe('Job nonexistent not found');
    });
  });

  describe('error handling', () => {
    it('returns error for unknown method', async () => {
      const request: MCPRequest = { method: 'resources/list' };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toBe("Method 'resources/list' not found");
    });

    it('returns error for unknown tool name', async () => {
      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toBe("Tool 'nonexistent_tool' not found");
    });

    it('wraps handler exceptions into error responses', async () => {
      mockMapsRepo.findAll.mockRejectedValue(new Error('Database connection failed'));

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'list_maps', arguments: {} },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32000);
      expect(response.error!.message).toBe('Database connection failed');
    });

    it('handles non-Error thrown values gracefully', async () => {
      mockMapsRepo.findAll.mockRejectedValue('string error');

      const request: MCPRequest = {
        method: 'tools/call',
        params: { name: 'list_maps', arguments: {} },
      };
      const response = await mcpServer.handleRequest(request);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32000);
      expect(response.error!.message).toBe('Unknown error');
    });
  });

  describe('getTools()', () => {
    it('returns all 7 registered tools', () => {
      const tools = mcpServer.getTools();

      expect(tools).toHaveLength(7);
      const names = tools.map((t) => t.name);
      expect(names).toContain('list_maps');
      expect(names).toContain('get_map_status');
      expect(names).toContain('get_component_details');
      expect(names).toContain('execute_action');
      expect(names).toContain('list_agents');
      expect(names).toContain('get_check_history');
      expect(names).toContain('get_job_status');
    });

    it('each tool has a callable handler', () => {
      const tools = mcpServer.getTools();

      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function');
      }
    });
  });

  describe('tools/call response format', () => {
    it('wraps successful results in MCP content format', async () => {
      mockMapsRepo.findAll.mockResolvedValue([]);

      const response = await mcpServer.handleRequest({
        method: 'tools/call',
        params: { name: 'list_maps', arguments: {} },
      });

      expect(response.result).toBeDefined();
      const result = response.result as { content: Array<{ type: string; text: string }> };
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(typeof result.content[0].text).toBe('string');

      // Verify it is valid JSON
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual({ maps: [] });
    });

    it('uses default empty object for arguments when not provided', async () => {
      mockMapsRepo.findAll.mockResolvedValue([]);

      const response = await mcpServer.handleRequest({
        method: 'tools/call',
        params: { name: 'list_maps' },
      });

      expect(response.error).toBeUndefined();
    });
  });
});
