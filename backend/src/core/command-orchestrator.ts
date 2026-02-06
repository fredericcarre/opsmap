import { EventEmitter } from 'events';
import { createChildLogger } from '../config/logger.js';
import { jobsRepository, componentsRepository } from '../db/repositories/index.js';
import { gatewayManager } from '../gateway/manager.js';
import { AgentCommand } from '../gateway/types.js';
import { ComponentConfig } from '../types/index.js';
import { fsmManager, ComponentEvent } from './fsm/index.js';

const logger = createChildLogger('command-orchestrator');

// Completion check types matching the spec
export interface CompletionCheck {
  type: 'service_status' | 'process_running' | 'process_stopped' | 'http_healthy' | 'port_open' | 'file_exists' | 'custom_command' | 'all' | 'any';
  service_name?: string;
  expected_status?: string;
  process_name?: string;
  listening_port?: number;
  url?: string;
  expected_http_status?: number;
  body_contains?: string;
  port?: number;
  host?: string;
  should_be_open?: boolean;
  path?: string;
  should_exist?: boolean;
  command?: string;
  args?: string[];
  expected_exit_code?: number;
  checks?: CompletionCheck[];
}

export interface ExecutionMode {
  type: 'sync' | 'async';
  timeout_ms?: number;
  completion_check?: CompletionCheck;
  poll_interval_ms?: number;
  max_wait_ms?: number;
}

export interface ActiveJob {
  jobId: string;
  agentId: string;
  componentId?: string;
  commandName: string;
  startedAt: Date;
  executionMode: ExecutionMode;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  lastPollAt?: Date;
  pollCount: number;
}

// Commands that are always synchronous (fast)
const SYNC_COMMAND_PATTERNS = [
  'native.*',
  'service.status',
  'file.exists',
  'file.read',
  'file.checksum',
  'port.check',
  'http.check',
  'process.list',
  'process.info',
  'discovery.*',
  'status',
];

// Commands that are always asynchronous (potentially long)
const ASYNC_COMMAND_PATTERNS = [
  'service.start',
  'service.stop',
  'service.restart',
  'start',
  'stop',
  'restart',
  'execute',
  'action.*',
];

function matchesPattern(commandName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('.*')) {
      return commandName.startsWith(pattern.slice(0, -2));
    }
    return commandName === pattern;
  });
}

class CommandOrchestrator extends EventEmitter {
  private activeJobs: Map<string, ActiveJob> = new Map();
  private pollingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
  }

  /**
   * Determine execution mode based on command type and component config
   */
  determineExecutionMode(commandName: string, componentConfig?: ComponentConfig): ExecutionMode {
    // Check component config for explicit execution mode
    const action = componentConfig?.actions?.find((a) => a.name === commandName);
    if (action) {
      if (action.async === false) {
        return { type: 'sync', timeout_ms: 30000 };
      }
      if (action.async === true) {
        const completionCheck = action.completionCheck
          ? this.convertCheckToCompletionCheck(action.completionCheck)
          : this.inferCompletionCheck(commandName, componentConfig);

        return {
          type: 'async',
          completion_check: completionCheck,
          poll_interval_ms: 2000,
          max_wait_ms: 300000,
        };
      }
    }

    // Auto-determine based on command name
    if (matchesPattern(commandName, SYNC_COMMAND_PATTERNS)) {
      return { type: 'sync', timeout_ms: 30000 };
    }

    if (matchesPattern(commandName, ASYNC_COMMAND_PATTERNS)) {
      return {
        type: 'async',
        completion_check: this.inferCompletionCheck(commandName, componentConfig),
        poll_interval_ms: 2000,
        max_wait_ms: 300000,
      };
    }

    // Default: sync with generous timeout
    return { type: 'sync', timeout_ms: 60000 };
  }

  /**
   * Infer a completion check from the command type
   */
  private inferCompletionCheck(commandName: string, config?: ComponentConfig): CompletionCheck {
    const checks = config?.checks || [];
    const httpCheck = checks.find((c) => c.type === 'http');
    const tcpCheck = checks.find((c) => c.type === 'tcp');

    if (commandName === 'start' || commandName === 'restart' || commandName === 'service.start') {
      const subChecks: CompletionCheck[] = [];

      if (httpCheck) {
        subChecks.push({
          type: 'http_healthy',
          url: httpCheck.config.url as string,
          expected_http_status: (httpCheck.config.expectedStatus as number) || 200,
        });
      }

      if (tcpCheck) {
        subChecks.push({
          type: 'port_open',
          port: tcpCheck.config.port as number,
          host: (tcpCheck.config.host as string) || '127.0.0.1',
          should_be_open: true,
        });
      }

      if (subChecks.length > 1) {
        return { type: 'all', checks: subChecks };
      }
      if (subChecks.length === 1) {
        return subChecks[0];
      }

      // Fallback: just check the process is running
      return { type: 'process_running', process_name: config?.metadata?.processName as string || commandName };
    }

    if (commandName === 'stop' || commandName === 'service.stop') {
      if (tcpCheck) {
        return {
          type: 'port_open',
          port: tcpCheck.config.port as number,
          host: (tcpCheck.config.host as string) || '127.0.0.1',
          should_be_open: false,
        };
      }
      return { type: 'process_stopped', process_name: config?.metadata?.processName as string || commandName };
    }

    // Generic fallback
    return { type: 'process_running', process_name: commandName };
  }

  /**
   * Convert a Check type from component config to CompletionCheck
   */
  private convertCheckToCompletionCheck(check: { type: string; config: Record<string, unknown> }): CompletionCheck {
    switch (check.type) {
      case 'http':
        return {
          type: 'http_healthy',
          url: check.config.url as string,
          expected_http_status: (check.config.expectedStatus as number) || 200,
          body_contains: check.config.bodyContains as string | undefined,
        };
      case 'tcp':
        return {
          type: 'port_open',
          port: check.config.port as number,
          host: (check.config.host as string) || '127.0.0.1',
          should_be_open: true,
        };
      case 'process':
        return {
          type: 'process_running',
          process_name: check.config.processName as string,
        };
      case 'service':
        return {
          type: 'service_status',
          service_name: check.config.serviceName as string,
          expected_status: (check.config.expectedStatus as string) || 'running',
        };
      default:
        return { type: 'process_running', process_name: 'unknown' };
    }
  }

  /**
   * Execute a component command with automatic sync/async handling
   */
  async executeCommand(params: {
    mapId: string;
    componentId: string;
    commandName: string;
    userId: string;
    params?: Record<string, unknown>;
  }): Promise<{ success: boolean; jobId?: string; error?: string; mode?: string }> {
    const { mapId, componentId, commandName, userId } = params;

    const component = await componentsRepository.findById(componentId);
    if (!component) {
      return { success: false, error: 'Component not found' };
    }

    const config = component.config as ComponentConfig;
    const executionMode = this.determineExecutionMode(commandName, config);

    // Find action
    const actions = config.actions || [];
    const action = actions.find((a) => a.name === commandName);
    if (!action) {
      return { success: false, error: `Action '${commandName}' not defined for this component` };
    }

    // Find agent
    const agentSelector = config.agentSelector;
    let agentId: string | undefined;

    if (agentSelector?.agentId) {
      agentId = agentSelector.agentId;
    } else if (agentSelector?.labels) {
      const agent = gatewayManager.findAgentByLabels(agentSelector.labels);
      agentId = agent?.id;
    }

    if (!agentId) {
      return { success: false, error: 'No agent found for this component' };
    }

    if (!gatewayManager.isAgentOnline(agentId)) {
      return { success: false, error: 'Agent is offline' };
    }

    // Create job
    const job = await jobsRepository.create({
      type: 'action',
      mapId,
      componentId,
      agentId,
      command: action.command,
      args: action.args,
      createdBy: userId,
    });

    // Build agent command with execution mode
    const agentCommand: AgentCommand = {
      id: job.id,
      command_type: executionMode.type,
      name: commandName,
      args: {
        command: action.command,
        args: action.args || [],
        run_as_user: action.runAsUser,
        component_id: componentId,
        map_id: mapId,
        completion_check: executionMode.completion_check,
        ...params.params,
      },
      timeout_secs: executionMode.type === 'sync'
        ? Math.ceil((executionMode.timeout_ms || 30000) / 1000)
        : 300,
    };

    // Send to gateway
    const result = await gatewayManager.sendCommand(job.id, agentId, undefined, agentCommand);

    if (!result.sent) {
      await jobsRepository.markFailed(job.id, result.error || 'Failed to send command');
      return { success: false, error: result.error, jobId: job.id };
    }

    logger.info(
      { jobId: job.id, componentId, commandName, agentId, mode: executionMode.type },
      'Command sent to agent'
    );

    // For async commands, start polling
    if (executionMode.type === 'async') {
      this.startPolling(job.id, agentId, componentId, commandName, executionMode);
    }

    // Update FSM state based on command type
    const fsmEvent = this.commandToFSMEvent(commandName);
    if (fsmEvent) {
      fsmManager.processEvent({
        type: fsmEvent,
        componentId,
        mapId,
        timestamp: new Date(),
        data: { jobId: job.id },
      });
    }

    this.emit('command:sent', {
      jobId: job.id,
      componentId,
      commandName,
      agentId,
      mode: executionMode.type,
    });

    return {
      success: true,
      jobId: job.id,
      mode: executionMode.type,
    };
  }

  /**
   * Start polling for async job completion
   */
  private startPolling(
    jobId: string,
    agentId: string,
    componentId: string | undefined,
    commandName: string,
    mode: ExecutionMode
  ): void {
    const activeJob: ActiveJob = {
      jobId,
      agentId,
      componentId,
      commandName,
      startedAt: new Date(),
      executionMode: mode,
      status: 'running',
      pollCount: 0,
    };

    this.activeJobs.set(jobId, activeJob);

    this.emit('job:started', { jobId, agentId, componentId, commandName });

    const pollInterval = mode.poll_interval_ms || 2000;
    const maxWait = mode.max_wait_ms || 300000;

    const poll = async () => {
      const job = this.activeJobs.get(jobId);
      if (!job || job.status !== 'running') {
        this.stopPolling(jobId);
        return;
      }

      const elapsed = Date.now() - job.startedAt.getTime();
      if (elapsed > maxWait) {
        await this.handleJobTimeout(jobId);
        return;
      }

      job.pollCount++;
      job.lastPollAt = new Date();

      // Check job status in DB (updated by gateway manager when response arrives)
      const dbJob = await jobsRepository.findById(jobId);
      if (!dbJob) {
        this.stopPolling(jobId);
        return;
      }

      if (dbJob.status === 'completed') {
        job.status = 'completed';
        this.stopPolling(jobId);
        if (componentId) {
          fsmManager.processEvent({
            type: 'command_completed',
            componentId,
            mapId: dbJob.mapId || '',
            timestamp: new Date(),
            data: { jobId },
          });
        }
        this.emit('job:completed', { jobId, agentId, componentId, elapsed });
        logger.info({ jobId, elapsed, pollCount: job.pollCount }, 'Async job completed');
        return;
      }

      if (dbJob.status === 'failed') {
        job.status = 'failed';
        this.stopPolling(jobId);
        if (componentId) {
          fsmManager.processEvent({
            type: 'command_failed',
            componentId,
            mapId: dbJob.mapId || '',
            timestamp: new Date(),
            data: { jobId, error: dbJob.result },
          });
        }
        this.emit('job:failed', { jobId, agentId, componentId, error: dbJob.result });
        logger.info({ jobId, elapsed }, 'Async job failed');
        return;
      }

      this.emit('job:poll', { jobId, pollCount: job.pollCount, elapsed });
    };

    // Start polling
    const timer = setInterval(poll, pollInterval);
    this.pollingTimers.set(jobId, timer);

    // First poll after initial delay
    setTimeout(poll, pollInterval);
  }

  private async handleJobTimeout(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    job.status = 'timeout';
    this.stopPolling(jobId);

    await jobsRepository.markTimeout(jobId);

    if (job.componentId) {
      fsmManager.processEvent({
        type: 'command_timeout',
        componentId: job.componentId,
        mapId: '',
        timestamp: new Date(),
        data: { jobId },
      });
    }

    this.emit('job:timeout', {
      jobId,
      agentId: job.agentId,
      componentId: job.componentId,
      elapsed: Date.now() - job.startedAt.getTime(),
    });

    logger.warn({ jobId, pollCount: job.pollCount }, 'Async job timed out');
  }

  private stopPolling(jobId: string): void {
    const timer = this.pollingTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(jobId);
    }
    this.activeJobs.delete(jobId);
  }

  /**
   * Cancel an active job
   */
  cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (!job) return false;

    job.status = 'failed';
    this.stopPolling(jobId);
    this.emit('job:cancelled', { jobId });

    return true;
  }

  /**
   * Get all currently active (polling) jobs
   */
  getActiveJobs(): ActiveJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Map a command name to the appropriate FSM event.
   */
  private commandToFSMEvent(commandName: string): ComponentEvent | null {
    if (commandName === 'start' || commandName === 'service.start') return 'start';
    if (commandName === 'stop' || commandName === 'service.stop') return 'stop';
    if (commandName === 'restart' || commandName === 'service.restart') return 'restart';
    return null;
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    for (const timer of this.pollingTimers.values()) {
      clearInterval(timer);
    }
    this.pollingTimers.clear();
    this.activeJobs.clear();
  }
}

export const commandOrchestrator = new CommandOrchestrator();
