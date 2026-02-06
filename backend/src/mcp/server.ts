import { createChildLogger } from '../config/logger.js';
import {
  mapsRepository,
  componentsRepository,
  checkResultsRepository,
  agentsRepository,
  gatewaysRepository,
  jobsRepository,
} from '../db/repositories/index.js';
import { commandService } from '../gateway/index.js';

const logger = createChildLogger('mcp-server');

/**
 * MCP (Model Context Protocol) Server for OpsMap.
 *
 * Exposes OpsMap capabilities as MCP tools that AI assistants can invoke:
 * - list_maps: List all application maps
 * - get_map_status: Get real-time status of all components in a map
 * - get_component_details: Get detailed info about a specific component
 * - execute_action: Execute an action on a component (start/stop/restart/custom)
 * - list_agents: List all connected agents
 * - get_check_history: Get historical check results for a component
 * - get_job_status: Get the status of a running job
 */

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface MCPRequest {
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  result?: unknown;
  error?: { code: number; message: string };
}

class MCPServer {
  private tools: Map<string, MCPTool> = new Map();

  constructor() {
    this.registerTools();
  }

  private registerTools(): void {
    this.register({
      name: 'list_maps',
      description: 'List all application maps accessible to the current user. Returns map names, descriptions, and component counts.',
      parameters: {
        workspaceId: { type: 'string', description: 'Filter by workspace ID (optional)' },
      },
      handler: async (_params) => {
        const maps = await mapsRepository.findAll();
        const result = await Promise.all(
          maps.map(async (map) => {
            const components = await componentsRepository.findByMap(map.id);
            return {
              id: map.id,
              name: map.name,
              description: map.description,
              componentCount: components.length,
              updatedAt: map.updatedAt,
            };
          })
        );
        return { maps: result };
      },
    });

    this.register({
      name: 'get_map_status',
      description: 'Get the real-time status of all components in a map. Returns each component with its latest health check status.',
      parameters: {
        mapId: { type: 'string', description: 'The ID of the map', required: true },
      },
      handler: async (params) => {
        const mapId = params.mapId as string;
        const map = await mapsRepository.findById(mapId);
        if (!map) throw new Error(`Map ${mapId} not found`);

        const status = await checkResultsRepository.getMapStatus(mapId);
        return {
          map: { id: map.id, name: map.name },
          components: status,
        };
      },
    });

    this.register({
      name: 'get_component_details',
      description: 'Get detailed information about a specific component including its configuration, checks, actions, and recent check history.',
      parameters: {
        componentId: { type: 'string', description: 'The ID of the component', required: true },
      },
      handler: async (params) => {
        const componentId = params.componentId as string;
        const component = await componentsRepository.findById(componentId);
        if (!component) throw new Error(`Component ${componentId} not found`);

        const [status, recentJobs] = await Promise.all([
          checkResultsRepository.getComponentStatus(componentId),
          jobsRepository.findByComponent(componentId, 5),
        ]);

        return {
          component: {
            id: component.id,
            name: component.name,
            type: component.type,
            config: component.config,
          },
          status: status.status,
          checks: status.checks,
          recentJobs: recentJobs.map((j) => ({
            id: j.id,
            command: j.command,
            status: j.status,
            createdAt: j.createdAt,
            completedAt: j.completedAt,
          })),
        };
      },
    });

    this.register({
      name: 'execute_action',
      description: 'Execute an action on a component. Supported actions: start, stop, restart, or any custom action defined in the component configuration.',
      parameters: {
        mapId: { type: 'string', description: 'The map ID', required: true },
        componentId: { type: 'string', description: 'The component ID', required: true },
        action: { type: 'string', description: 'Action name: start, stop, restart, or custom action name', required: true },
        userId: { type: 'string', description: 'User ID executing the action', required: true },
      },
      handler: async (params) => {
        const result = await commandService.executeComponentCommand({
          mapId: params.mapId as string,
          componentId: params.componentId as string,
          commandName: params.action as string,
          userId: params.userId as string,
        });
        return result;
      },
    });

    this.register({
      name: 'list_agents',
      description: 'List all registered agents with their connection status, hostname, labels, and gateway information.',
      parameters: {},
      handler: async () => {
        const agents = await agentsRepository.findAll();
        const gateways = await gatewaysRepository.findAll();
        const gatewayMap = new Map(gateways.map((g) => [g.id, g]));

        return {
          agents: agents.map((a) => ({
            id: a.id,
            hostname: a.hostname,
            labels: a.labels,
            status: a.status,
            version: a.version,
            os: a.os,
            gateway: a.gatewayId ? gatewayMap.get(a.gatewayId)?.name : null,
            zone: a.gatewayId ? gatewayMap.get(a.gatewayId)?.zone : null,
            lastHeartbeat: a.lastHeartbeat,
          })),
        };
      },
    });

    this.register({
      name: 'get_check_history',
      description: 'Get historical check results for a component. Useful for analyzing trends and diagnosing issues.',
      parameters: {
        componentId: { type: 'string', description: 'The component ID', required: true },
        checkName: { type: 'string', description: 'Specific check name to filter (optional)' },
        limit: { type: 'number', description: 'Maximum results to return (default: 50)' },
      },
      handler: async (params) => {
        const componentId = params.componentId as string;
        const checkName = params.checkName as string | undefined;
        const limit = (params.limit as number) || 50;

        let results;
        if (checkName) {
          results = await checkResultsRepository.findByComponentAndCheck(componentId, checkName, limit);
        } else {
          results = await checkResultsRepository.findByComponent(componentId, limit);
        }

        return { results };
      },
    });

    this.register({
      name: 'get_job_status',
      description: 'Get the current status of a job (command execution). Returns the job details including result if completed.',
      parameters: {
        jobId: { type: 'string', description: 'The job ID', required: true },
      },
      handler: async (params) => {
        const job = await jobsRepository.findById(params.jobId as string);
        if (!job) throw new Error(`Job ${params.jobId} not found`);
        return { job };
      },
    });

    logger.info({ toolCount: this.tools.size }, 'MCP tools registered');
  }

  private register(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Handle an MCP request
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    if (request.method === 'tools/list') {
      return {
        result: {
          tools: Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(t.parameters).map(([key, param]) => [
                  key,
                  { type: param.type, description: param.description },
                ])
              ),
              required: Object.entries(t.parameters)
                .filter(([, p]) => p.required)
                .map(([k]) => k),
            },
          })),
        },
      };
    }

    if (request.method === 'tools/call') {
      const toolName = request.params?.name as string;
      const args = (request.params?.arguments || {}) as Record<string, unknown>;

      const tool = this.tools.get(toolName);
      if (!tool) {
        return { error: { code: -32601, message: `Tool '${toolName}' not found` } };
      }

      try {
        const result = await tool.handler(args);
        return { result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ error, tool: toolName }, 'MCP tool execution failed');
        return { error: { code: -32000, message } };
      }
    }

    return { error: { code: -32601, message: `Method '${request.method}' not found` } };
  }

  /**
   * Get all available tools (for documentation)
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }
}

export const mcpServer = new MCPServer();
