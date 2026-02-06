import { createChildLogger } from '../config/logger.js';
import { componentsRepository, agentsRepository, agentSnapshotsRepository } from '../db/repositories/index.js';
import { gatewayManager } from '../gateway/manager.js';
import {
  SnapshotPayload,
  SnapshotComponent,
  SnapshotCheck,
  SnapshotAction,
} from '../gateway/types.js';
import { ComponentConfig, Component } from '../types/index.js';

const logger = createChildLogger('snapshot-service');

/**
 * SnapshotService builds and sends component configuration snapshots to agents.
 *
 * The agent receives a snapshot containing:
 * - Components it manages (based on agentSelector)
 * - Checks to execute (with intervals)
 * - Commands/actions definitions
 *
 * The agent then schedules checks locally and sends only deltas.
 */
export const snapshotService = {
  /**
   * Build a snapshot for a specific agent containing all components it manages
   */
  async buildSnapshotForAgent(agentId: string): Promise<SnapshotPayload> {
    // Get agent info
    const agent = await agentsRepository.findById(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Find all components that target this agent
    const allComponents = await componentsRepository.findAll();

    const matchingComponents = allComponents.filter((component) => {
      const config = component.config as ComponentConfig;
      const selector = config.agentSelector;
      if (!selector) return false;

      // Match by explicit agent ID
      if (selector.agentId === agentId) return true;

      // Match by labels
      if (selector.labels && agent.labels) {
        return Object.entries(selector.labels).every(
          ([key, value]) => agent.labels[key] === value
        );
      }

      return false;
    });

    const snapshotComponents: SnapshotComponent[] = matchingComponents.map((component) =>
      this.buildSnapshotComponent(component)
    );

    logger.info(
      { agentId, componentCount: snapshotComponents.length },
      'Snapshot built for agent'
    );

    return {
      agent_id: agentId,
      snapshot: {
        components: snapshotComponents,
      },
    };
  },

  /**
   * Convert a Component to a SnapshotComponent for the agent
   */
  buildSnapshotComponent(component: Component): SnapshotComponent {
    const config = component.config as ComponentConfig;

    const checks: SnapshotCheck[] = (config.checks || []).map((check) => ({
      name: check.name,
      type: check.type,
      config: check.config,
      interval_secs: check.intervalSecs,
      timeout_secs: check.timeoutSecs,
    }));

    const actions: SnapshotAction[] = (config.actions || []).map((action) => ({
      name: action.name,
      command: action.command,
      args: action.args || [],
      run_as_user: action.runAsUser,
      async: action.async,
      timeout_secs: action.async ? 300 : 60,
    }));

    return {
      id: component.id,
      external_id: component.name,
      checks,
      actions,
    };
  },

  /**
   * Send a snapshot to a specific agent via its gateway
   */
  async sendSnapshotToAgent(agentId: string): Promise<boolean> {
    try {
      const snapshot = await this.buildSnapshotForAgent(agentId);

      // Find the gateway for this agent
      const connectedAgents = gatewayManager.getConnectedAgents();
      const agentInfo = connectedAgents.find((a) => a.id === agentId);

      if (!agentInfo) {
        logger.warn({ agentId }, 'Agent not connected, cannot send snapshot');
        return false;
      }

      const sent = gatewayManager.sendToGateway(agentInfo.gatewayId, {
        type: 'snapshot',
        payload: snapshot,
      });

      if (sent) {
        logger.info({ agentId, gatewayId: agentInfo.gatewayId }, 'Snapshot sent to agent');

        // Persist snapshot to DB grouped by map
        const allComponents = await componentsRepository.findAll();
        const snapshotComponentIds = new Set(snapshot.snapshot.components.map((sc) => sc.id));
        const matchedComponents = allComponents.filter((c) => snapshotComponentIds.has(c.id));

        // Group by mapId
        const byMap = new Map<string, typeof matchedComponents>();
        for (const comp of matchedComponents) {
          const list = byMap.get(comp.mapId) || [];
          list.push(comp);
          byMap.set(comp.mapId, list);
        }

        for (const [mapId, comps] of byMap) {
          const snapshotComps = snapshot.snapshot.components.filter((sc) =>
            comps.some((c) => c.id === sc.id)
          );

          await agentSnapshotsRepository.upsert({
            agentId,
            mapId,
            components: snapshotComps.map((c) => c.id),
            checks: JSON.parse(JSON.stringify(snapshotComps.flatMap((c) => c.checks))),
            commands: JSON.parse(JSON.stringify(snapshotComps.flatMap((c) => c.actions))),
          }).catch((err) => {
            logger.warn({ err, agentId, mapId }, 'Failed to persist agent snapshot');
          });
        }
      }

      return sent;
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to send snapshot');
      return false;
    }
  },

  /**
   * Send snapshots to all connected agents
   */
  async sendSnapshotsToAllAgents(): Promise<{ sent: number; failed: number }> {
    const connectedAgents = gatewayManager.getConnectedAgents();
    let sent = 0;
    let failed = 0;

    for (const agent of connectedAgents) {
      const success = await this.sendSnapshotToAgent(agent.id);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    }

    logger.info({ sent, failed, total: connectedAgents.length }, 'Snapshots sent to all agents');
    return { sent, failed };
  },

  /**
   * Send snapshot when a map's components change
   */
  async onMapUpdated(mapId: string): Promise<void> {
    const components = await componentsRepository.findByMap(mapId);

    // Find all affected agents
    const agentIds = new Set<string>();
    for (const component of components) {
      const config = component.config as ComponentConfig;
      if (config.agentSelector?.agentId) {
        agentIds.add(config.agentSelector.agentId);
      }
    }

    // Send updated snapshots
    for (const agentId of agentIds) {
      await this.sendSnapshotToAgent(agentId);
    }
  },
};
