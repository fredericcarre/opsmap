import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { createChildLogger } from '../config/logger.js';
import {
  gatewaysRepository,
  agentsRepository,
  jobsRepository,
} from '../db/repositories/index.js';
import {
  GatewayToBackendMessage,
  BackendToGatewayMessage,
  CommandPayload,
  AgentCommand,
  CommandResponse,
  StatusUpdate,
  AgentInfo,
} from './types.js';
import { fsmManager, ComponentEvent } from '../core/fsm/index.js';
import { checkResultsRepository } from '../db/repositories/index.js';

const logger = createChildLogger('gateway-manager');

interface ConnectedGateway {
  id: string;
  zone: string;
  ws: WebSocket;
  agents: Map<string, AgentInfo>;
  connectedAt: Date;
  lastHeartbeat: Date;
}

class GatewayManager extends EventEmitter {
  private gateways: Map<string, ConnectedGateway> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  start(): void {
    // Heartbeat to check gateway health
    this.heartbeatInterval = setInterval(() => this.checkGatewaysHealth(), 30000);

    // Cleanup stale connections
    this.cleanupInterval = setInterval(() => this.cleanupStaleConnections(), 60000);

    logger.info('Gateway manager started');
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const gateway of this.gateways.values()) {
      gateway.ws.close();
    }
    this.gateways.clear();

    logger.info('Gateway manager stopped');
  }

  handleConnection(ws: WebSocket): void {
    let gatewayId: string | null = null;

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message: GatewayToBackendMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'register':
            gatewayId = await this.handleRegister(ws, message.payload);
            break;
          case 'agent_connected':
            if (gatewayId) {
              await this.handleAgentConnected(gatewayId, message.payload);
            }
            break;
          case 'agent_disconnected':
            if (gatewayId) {
              await this.handleAgentDisconnected(gatewayId, message.payload.agent_id);
            }
            break;
          case 'status_update':
            await this.handleStatusUpdate(message.payload);
            break;
          case 'command_response':
            await this.handleCommandResponse(message.payload);
            break;
          case 'pong':
            if (gatewayId) {
              this.handlePong(gatewayId);
            }
            break;
        }
      } catch (error) {
        logger.error({ error }, 'Failed to handle gateway message');
      }
    });

    ws.on('close', async () => {
      if (gatewayId) {
        await this.handleDisconnect(gatewayId);
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, gatewayId }, 'Gateway WebSocket error');
    });
  }

  private async handleRegister(
    ws: WebSocket,
    payload: { gateway_id: string; zone: string; version: string; agents: AgentInfo[] }
  ): Promise<string> {
    const gatewayId = payload.gateway_id;

    logger.info(
      { gatewayId, zone: payload.zone, agentCount: payload.agents.length },
      'Gateway registered'
    );

    // Store connection
    const gateway: ConnectedGateway = {
      id: gatewayId,
      zone: payload.zone,
      ws,
      agents: new Map(),
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    };

    // Add existing agents
    for (const agent of payload.agents) {
      gateway.agents.set(agent.id, agent);
    }

    this.gateways.set(gatewayId, gateway);

    // Update database
    await gatewaysRepository.upsert({
      id: gatewayId,
      name: gatewayId,
      zone: payload.zone,
      url: `internal://${gatewayId}`,
    });

    // Register all agents
    for (const agent of payload.agents) {
      await agentsRepository.upsert({
        id: agent.id,
        gatewayId,
        hostname: agent.hostname,
        labels: agent.labels,
        version: agent.version,
        os: agent.os,
      });
    }

    await gatewaysRepository.updateAgentCount(gatewayId, payload.agents.length);

    this.emit('gateway:connected', { gatewayId, zone: payload.zone });

    return gatewayId;
  }

  private async handleAgentConnected(gatewayId: string, agent: AgentInfo): Promise<void> {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return;

    gateway.agents.set(agent.id, agent);

    logger.info({ gatewayId, agentId: agent.id, hostname: agent.hostname }, 'Agent connected');

    await agentsRepository.upsert({
      id: agent.id,
      gatewayId,
      hostname: agent.hostname,
      labels: agent.labels,
      version: agent.version,
      os: agent.os,
    });

    await gatewaysRepository.updateAgentCount(gatewayId, gateway.agents.size);

    this.emit('agent:connected', { agentId: agent.id, gatewayId, hostname: agent.hostname });
  }

  private async handleAgentDisconnected(gatewayId: string, agentId: string): Promise<void> {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return;

    gateway.agents.delete(agentId);

    logger.info({ gatewayId, agentId }, 'Agent disconnected');

    await agentsRepository.markOffline(agentId);
    await gatewaysRepository.updateAgentCount(gatewayId, gateway.agents.size);

    this.emit('agent:disconnected', { agentId, gatewayId });
  }

  private async handleStatusUpdate(status: StatusUpdate): Promise<void> {
    logger.debug(
      { agentId: status.agent_id, componentId: status.component_id, status: status.status },
      'Status update received'
    );

    // Persist check result to database
    if (status.component_id && status.check_name) {
      try {
        await checkResultsRepository.create({
          componentId: status.component_id,
          checkName: status.check_name,
          status: status.status,
          message: status.message,
          metrics: status.metrics,
          durationMs: 0,
        });
      } catch (err) {
        logger.warn({ err, componentId: status.component_id }, 'Failed to persist check result');
      }
    }

    // Feed FSM with health check events
    if (status.component_id) {
      const fsmEvent: ComponentEvent =
        status.status === 'ok' ? 'health_ok' :
        status.status === 'warning' ? 'health_warning' :
        'health_fail';

      fsmManager.processEvent({
        type: fsmEvent,
        componentId: status.component_id,
        mapId: '',
        timestamp: new Date(status.timestamp),
        data: { message: status.message, checkName: status.check_name },
      });
    }

    // Emit event for WebSocket clients
    this.emit('status:update', status);
  }

  private async handleCommandResponse(response: CommandResponse): Promise<void> {
    logger.info(
      { jobId: response.job_id, status: response.status },
      'Command response received'
    );

    // Update job in database
    const job = await jobsRepository.findById(response.job_id);
    if (!job) {
      logger.warn({ jobId: response.job_id }, 'Job not found for response');
      return;
    }

    switch (response.status) {
      case 'started':
        await jobsRepository.markStarted(response.job_id);
        break;
      case 'completed':
        if (response.result) {
          await jobsRepository.markCompleted(response.job_id, {
            exitCode: response.result.exit_code,
            stdout: response.result.stdout,
            stderr: response.result.stderr,
            durationMs: response.result.duration_ms,
            timedOut: response.result.timed_out,
          });
        }
        break;
      case 'failed':
        await jobsRepository.markFailed(response.job_id, response.error || 'Unknown error');
        break;
      case 'timeout':
        await jobsRepository.markTimeout(response.job_id);
        break;
    }

    this.emit('job:update', { jobId: response.job_id, status: response.status, response });
  }

  private handlePong(gatewayId: string): void {
    const gateway = this.gateways.get(gatewayId);
    if (gateway) {
      gateway.lastHeartbeat = new Date();
    }
  }

  private async handleDisconnect(gatewayId: string): Promise<void> {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway) return;

    logger.info({ gatewayId }, 'Gateway disconnected');

    // Mark all agents as offline
    for (const agentId of gateway.agents.keys()) {
      await agentsRepository.markOffline(agentId);
    }

    await gatewaysRepository.markOffline(gatewayId);
    this.gateways.delete(gatewayId);

    this.emit('gateway:disconnected', { gatewayId });
  }

  private checkGatewaysHealth(): void {
    const now = new Date();
    const timeout = 90000; // 90 seconds

    for (const [gatewayId, gateway] of this.gateways.entries()) {
      if (now.getTime() - gateway.lastHeartbeat.getTime() > timeout) {
        logger.warn({ gatewayId }, 'Gateway heartbeat timeout');
        gateway.ws.close();
      } else {
        // Send ping
        this.sendToGateway(gatewayId, { type: 'ping' });
      }
    }
  }

  private async cleanupStaleConnections(): Promise<void> {
    // Mark gateways with no recent heartbeat as offline
    const gateways = await gatewaysRepository.findAll();
    const now = new Date();

    for (const gw of gateways) {
      if (gw.status === 'online' && gw.lastHeartbeat) {
        const timeSinceHeartbeat = now.getTime() - new Date(gw.lastHeartbeat).getTime();
        if (timeSinceHeartbeat > 120000) { // 2 minutes
          await gatewaysRepository.markOffline(gw.id);
          await agentsRepository.markAllOfflineByGateway(gw.id);
        }
      }
    }
  }

  // Public API

  sendToGateway(gatewayId: string, message: BackendToGatewayMessage): boolean {
    const gateway = this.gateways.get(gatewayId);
    if (!gateway || gateway.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      gateway.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error({ error, gatewayId }, 'Failed to send message to gateway');
      return false;
    }
  }

  async sendCommand(
    jobId: string,
    agentId: string | undefined,
    labels: Record<string, string> | undefined,
    command: AgentCommand
  ): Promise<{ sent: boolean; gatewayId?: string; error?: string }> {
    // Find the gateway for this agent
    let targetGateway: ConnectedGateway | undefined;

    if (agentId) {
      // Find gateway with this agent
      for (const gateway of this.gateways.values()) {
        if (gateway.agents.has(agentId)) {
          targetGateway = gateway;
          break;
        }
      }

      if (!targetGateway) {
        // Try to find from database
        const agent = await agentsRepository.findById(agentId);
        if (agent && agent.gatewayId) {
          targetGateway = this.gateways.get(agent.gatewayId);
        }
      }
    } else if (labels) {
      // Find gateways with agents matching labels
      // For now, send to all gateways (they will filter by labels)
      const commandPayload: CommandPayload = {
        job_id: jobId,
        labels,
        command,
      };

      let sent = false;
      for (const gateway of this.gateways.values()) {
        if (this.sendToGateway(gateway.id, { type: 'command', payload: commandPayload })) {
          sent = true;
        }
      }

      return { sent, gatewayId: 'broadcast' };
    }

    if (!targetGateway) {
      return { sent: false, error: 'No gateway found for agent' };
    }

    const commandPayload: CommandPayload = {
      job_id: jobId,
      agent_id: agentId,
      command,
    };

    const sent = this.sendToGateway(targetGateway.id, { type: 'command', payload: commandPayload });
    return { sent, gatewayId: targetGateway.id };
  }

  getConnectedGateways(): Array<{ id: string; zone: string; agentCount: number }> {
    return Array.from(this.gateways.values()).map((gw) => ({
      id: gw.id,
      zone: gw.zone,
      agentCount: gw.agents.size,
    }));
  }

  getConnectedAgents(): Array<{ id: string; hostname: string; gatewayId: string }> {
    const agents: Array<{ id: string; hostname: string; gatewayId: string }> = [];
    for (const gateway of this.gateways.values()) {
      for (const agent of gateway.agents.values()) {
        agents.push({
          id: agent.id,
          hostname: agent.hostname,
          gatewayId: gateway.id,
        });
      }
    }
    return agents;
  }

  isAgentOnline(agentId: string): boolean {
    for (const gateway of this.gateways.values()) {
      if (gateway.agents.has(agentId)) {
        return true;
      }
    }
    return false;
  }

  findAgentByLabels(labels: Record<string, string>): AgentInfo | undefined {
    for (const gateway of this.gateways.values()) {
      for (const agent of gateway.agents.values()) {
        let matches = true;
        for (const [key, value] of Object.entries(labels)) {
          if (agent.labels[key] !== value) {
            matches = false;
            break;
          }
        }
        if (matches) {
          return agent;
        }
      }
    }
    return undefined;
  }
}

// Singleton instance
export const gatewayManager = new GatewayManager();
