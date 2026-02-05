import { createChildLogger } from '../config/logger.js';
import { jobsRepository, componentsRepository } from '../db/repositories/index.js';
import { gatewayManager } from './manager.js';
import { AgentCommand } from './types.js';
import { Job, ComponentConfig } from '../types/index.js';

const logger = createChildLogger('command-service');

export interface ExecuteCommandParams {
  mapId: string;
  componentId: string;
  commandName: 'start' | 'stop' | 'restart' | string;
  userId: string;
  params?: Record<string, unknown>;
}

export interface ExecuteCommandResult {
  success: boolean;
  jobId?: string;
  error?: string;
  message?: string;
}

export const commandService = {
  async executeComponentCommand(params: ExecuteCommandParams): Promise<ExecuteCommandResult> {
    const { mapId, componentId, commandName, userId, params: commandParams } = params;

    // Get component
    const component = await componentsRepository.findById(componentId);
    if (!component) {
      return { success: false, error: 'Component not found' };
    }

    const config = component.config as ComponentConfig;

    // Find action in component config
    let action: { name: string; command: string; args?: string[]; async?: boolean; runAsUser?: string } | undefined;
    // Check if it's a built-in command (start, stop, restart)
    if (['start', 'stop', 'restart'].includes(commandName)) {
      const actions = config.actions || [];
      action = actions.find((a) => a.name === commandName);
    } else {
      // Custom action
      const actions = config.actions || [];
      action = actions.find((a) => a.name === commandName);
    }

    if (!action) {
      return {
        success: false,
        error: `Action '${commandName}' not defined for this component`,
      };
    }

    // Determine which agent to use
    const agentSelector = config.agentSelector;
    let agentId: string | undefined;
    let labels: Record<string, string> | undefined;

    if (agentSelector?.agentId) {
      agentId = agentSelector.agentId;
    } else if (agentSelector?.labels) {
      labels = agentSelector.labels;

      // Try to find a specific agent
      const agent = gatewayManager.findAgentByLabels(labels);
      if (agent) {
        agentId = agent.id;
      }
    }

    // Check if agent is online
    if (agentId && !gatewayManager.isAgentOnline(agentId)) {
      return {
        success: false,
        error: 'Agent is offline',
      };
    }

    if (!agentId && !labels) {
      return {
        success: false,
        error: 'No agent selector defined for this component',
      };
    }

    // Create job
    const job = await jobsRepository.create({
      type: 'action',
      mapId,
      componentId,
      agentId: agentId || 'labels:' + JSON.stringify(labels),
      command: action.command,
      args: action.args,
      createdBy: userId,
    });

    // Build agent command
    const agentCommand: AgentCommand = {
      id: job.id,
      command_type: action.async !== false ? 'async' : 'sync',
      name: commandName,
      args: {
        command: action.command,
        args: action.args || [],
        run_as_user: action.runAsUser,
        component_id: componentId,
        map_id: mapId,
        ...commandParams,
      },
      timeout_secs: 300, // 5 minutes default
    };

    // Send command to gateway
    const result = await gatewayManager.sendCommand(job.id, agentId, labels, agentCommand);

    if (!result.sent) {
      await jobsRepository.markFailed(job.id, result.error || 'Failed to send command');
      return {
        success: false,
        error: result.error || 'Failed to send command to agent',
        jobId: job.id,
      };
    }

    logger.info(
      { jobId: job.id, componentId, commandName, agentId, gatewayId: result.gatewayId },
      'Command sent to agent'
    );

    return {
      success: true,
      jobId: job.id,
      message: `${commandName} command queued`,
    };
  },

  async executeNativeCommand(
    agentId: string,
    commandName: string,
    args: Record<string, unknown>,
    userId: string
  ): Promise<ExecuteCommandResult> {
    // Check if agent is online
    if (!gatewayManager.isAgentOnline(agentId)) {
      return { success: false, error: 'Agent is offline' };
    }

    // Create job
    const job = await jobsRepository.create({
      type: 'command',
      agentId,
      command: commandName,
      args: Object.values(args).map(String),
      createdBy: userId,
    });

    // Build agent command
    const agentCommand: AgentCommand = {
      id: job.id,
      command_type: 'sync',
      name: commandName,
      args,
      timeout_secs: 60,
    };

    // Send command
    const result = await gatewayManager.sendCommand(job.id, agentId, undefined, agentCommand);

    if (!result.sent) {
      await jobsRepository.markFailed(job.id, result.error || 'Failed to send command');
      return {
        success: false,
        error: result.error || 'Failed to send command to agent',
        jobId: job.id,
      };
    }

    return {
      success: true,
      jobId: job.id,
      message: `${commandName} command sent`,
    };
  },

  async getJobStatus(jobId: string): Promise<Job | null> {
    return jobsRepository.findById(jobId);
  },

  async waitForJobCompletion(jobId: string, timeoutMs = 30000): Promise<Job | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const job = await jobsRepository.findById(jobId);
      if (!job) return null;

      if (['completed', 'failed', 'timeout'].includes(job.status)) {
        return job;
      }

      // Wait 500ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Timeout
    const job = await jobsRepository.findById(jobId);
    return job;
  },
};
