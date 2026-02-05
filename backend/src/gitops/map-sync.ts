import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createChildLogger } from '../config/logger.js';
import { mapsRepository, componentsRepository } from '../db/repositories/index.js';
import { ComponentConfig } from '../types/index.js';

const logger = createChildLogger('gitops');
const execFileAsync = promisify(execFile);

export interface MapYAML {
  name: string;
  description?: string;
  components: MapComponentYAML[];
}

export interface MapComponentYAML {
  id: string;
  name: string;
  type: string;
  agent_selector?: {
    agent_id?: string;
    labels?: Record<string, string>;
  };
  dependencies?: string[];
  checks?: Array<{
    name: string;
    type: string;
    config: Record<string, unknown>;
    interval_secs: number;
    timeout_secs: number;
  }>;
  actions?: Array<{
    name: string;
    label: string;
    command: string;
    args?: string[];
    run_as_user?: string;
    async: boolean;
    confirmation_required?: boolean;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * GitOps Map Sync Service
 *
 * Syncs map definitions between Git repositories and the database.
 * Maps are defined as YAML files in Git and can be imported/exported.
 */
export const mapSyncService = {
  /**
   * Parse a YAML map definition into structured data
   */
  parseMapYAML(yamlContent: string): MapYAML {
    // Simple YAML-like parser for map definitions
    // In production, use a proper YAML library (js-yaml)
    // For now, we parse the YAML stored in the DB
    try {
      return JSON.parse(yamlContent) as MapYAML;
    } catch {
      throw new Error('Invalid map definition format');
    }
  },

  /**
   * Export a map and its components to a serialized format
   */
  async exportMap(mapId: string): Promise<MapYAML> {
    const map = await mapsRepository.findById(mapId);
    if (!map) throw new Error(`Map ${mapId} not found`);

    const components = await componentsRepository.findByMap(mapId);

    return {
      name: map.name,
      description: map.description || undefined,
      components: components.map((c) => {
        const config = c.config as ComponentConfig;
        return {
          id: c.name, // Use name as external ID
          name: c.name,
          type: c.type,
          agent_selector: config.agentSelector
            ? {
                agent_id: config.agentSelector.agentId,
                labels: config.agentSelector.labels,
              }
            : undefined,
          dependencies: config.dependencies,
          checks: config.checks?.map((check) => ({
            name: check.name,
            type: check.type,
            config: check.config,
            interval_secs: check.intervalSecs,
            timeout_secs: check.timeoutSecs,
          })),
          actions: config.actions?.map((action) => ({
            name: action.name,
            label: action.label,
            command: action.command,
            args: action.args,
            run_as_user: action.runAsUser,
            async: action.async,
            confirmation_required: action.confirmationRequired,
          })),
          metadata: config.metadata,
        };
      }),
    };
  },

  /**
   * Import a map definition, creating/updating components in the database
   */
  async importMap(mapId: string, definition: MapYAML): Promise<{ created: number; updated: number; deleted: number }> {
    const map = await mapsRepository.findById(mapId);
    if (!map) throw new Error(`Map ${mapId} not found`);

    const existingComponents = await componentsRepository.findByMap(mapId);
    const existingByName = new Map(existingComponents.map((c) => [c.name, c]));

    let created = 0;
    let updated = 0;

    const processedNames = new Set<string>();

    for (const comp of definition.components) {
      processedNames.add(comp.name);

      const config: ComponentConfig = {
        agentSelector: comp.agent_selector
          ? { agentId: comp.agent_selector.agent_id, labels: comp.agent_selector.labels }
          : undefined,
        dependencies: comp.dependencies,
        checks: comp.checks?.map((c) => ({
          name: c.name,
          type: c.type as 'http' | 'tcp' | 'command' | 'process' | 'service',
          config: c.config,
          intervalSecs: c.interval_secs,
          timeoutSecs: c.timeout_secs,
        })),
        actions: comp.actions?.map((a) => ({
          name: a.name,
          label: a.label,
          command: a.command,
          args: a.args,
          runAsUser: a.run_as_user,
          async: a.async,
          confirmationRequired: a.confirmation_required,
        })),
        metadata: comp.metadata,
      };

      const existing = existingByName.get(comp.name);
      if (existing) {
        await componentsRepository.update(existing.id, {
          name: comp.name,
          type: comp.type,
          config,
        });
        updated++;
      } else {
        await componentsRepository.create({
          mapId,
          externalId: comp.id || comp.name,
          name: comp.name,
          type: comp.type,
          config,
        });
        created++;
      }
    }

    // Delete components that are no longer in the definition
    let deleted = 0;
    for (const existing of existingComponents) {
      if (!processedNames.has(existing.name)) {
        await componentsRepository.deleteComponent(existing.id);
        deleted++;
      }
    }

    // Save the YAML content to the map
    await mapsRepository.update(mapId, {
      yaml: JSON.stringify(definition),
    });

    logger.info({ mapId, created, updated, deleted }, 'Map imported from definition');

    return { created, updated, deleted };
  },

  /**
   * Clone a Git repo and sync map definitions
   */
  async syncFromGit(mapId: string): Promise<{ synced: boolean; message: string }> {
    const map = await mapsRepository.findById(mapId);
    if (!map) throw new Error(`Map ${mapId} not found`);

    if (!map.gitRepoUrl) {
      return { synced: false, message: 'No Git repository URL configured for this map' };
    }

    const tmpDir = path.join(os.tmpdir(), `opsmap-git-${mapId}-${Date.now()}`);

    try {
      // Clone the repository
      await execFileAsync('git', [
        'clone',
        '--depth', '1',
        '--branch', map.gitBranch || 'main',
        map.gitRepoUrl,
        tmpDir,
      ], { timeout: 30000 });

      // Look for map definition file
      const mapFile = path.join(tmpDir, 'opsmap.json');
      let content: string;

      try {
        content = await fs.readFile(mapFile, 'utf-8');
      } catch {
        // Try opsmap.yaml fallback
        try {
          content = await fs.readFile(path.join(tmpDir, 'opsmap.yaml'), 'utf-8');
        } catch {
          return { synced: false, message: 'No opsmap.json or opsmap.yaml found in repository' };
        }
      }

      const definition = this.parseMapYAML(content);
      const result = await this.importMap(mapId, definition);

      logger.info({ mapId, repo: map.gitRepoUrl, ...result }, 'Map synced from Git');

      return {
        synced: true,
        message: `Synced: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`,
      };
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  },

  /**
   * Get diff between current DB state and a new definition
   */
  async diff(mapId: string, newDefinition: MapYAML): Promise<{
    added: string[];
    removed: string[];
    changed: string[];
    unchanged: string[];
  }> {
    const existingComponents = await componentsRepository.findByMap(mapId);
    const existingNames = new Set(existingComponents.map((c) => c.name));
    const newNames = new Set(newDefinition.components.map((c) => c.name));

    const added = newDefinition.components
      .filter((c) => !existingNames.has(c.name))
      .map((c) => c.name);

    const removed = existingComponents
      .filter((c) => !newNames.has(c.name))
      .map((c) => c.name);

    const changed: string[] = [];
    const unchanged: string[] = [];

    for (const comp of newDefinition.components) {
      const existing = existingComponents.find((c) => c.name === comp.name);
      if (existing) {
        // Simple comparison - in production, do a deep diff
        const existingConfig = JSON.stringify(existing.config);
        const newConfig = JSON.stringify({
          agentSelector: comp.agent_selector,
          dependencies: comp.dependencies,
          checks: comp.checks,
          actions: comp.actions,
          metadata: comp.metadata,
        });

        if (existingConfig !== newConfig) {
          changed.push(comp.name);
        } else {
          unchanged.push(comp.name);
        }
      }
    }

    return { added, removed, changed, unchanged };
  },
};
