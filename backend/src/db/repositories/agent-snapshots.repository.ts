import { getPool } from '../connection.js';

export interface AgentSnapshot {
  id: string;
  agentId: string;
  mapId: string;
  components: string[];
  checks: Record<string, unknown>[];
  commands: Record<string, unknown>[];
  createdAt: Date;
}

export interface UpsertSnapshotParams {
  agentId: string;
  mapId: string;
  components: string[];
  checks: Record<string, unknown>[];
  commands: Record<string, unknown>[];
}

export const agentSnapshotsRepository = {
  async upsert(params: UpsertSnapshotParams): Promise<AgentSnapshot> {
    const pool = getPool();
    const result = await pool.query<AgentSnapshot>(
      `INSERT INTO agent_snapshots (agent_id, map_id, components, checks, commands)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, map_id) DO UPDATE SET
         components = EXCLUDED.components,
         checks = EXCLUDED.checks,
         commands = EXCLUDED.commands,
         created_at = NOW()
       RETURNING
         id,
         agent_id as "agentId",
         map_id as "mapId",
         components, checks, commands,
         created_at as "createdAt"`,
      [
        params.agentId,
        params.mapId,
        JSON.stringify(params.components),
        JSON.stringify(params.checks),
        JSON.stringify(params.commands),
      ]
    );
    return result.rows[0];
  },

  async findByAgent(agentId: string): Promise<AgentSnapshot[]> {
    const pool = getPool();
    const result = await pool.query<AgentSnapshot>(
      `SELECT
         id,
         agent_id as "agentId",
         map_id as "mapId",
         components, checks, commands,
         created_at as "createdAt"
       FROM agent_snapshots
       WHERE agent_id = $1`,
      [agentId]
    );
    return result.rows;
  },

  async findByAgentAndMap(agentId: string, mapId: string): Promise<AgentSnapshot | null> {
    const pool = getPool();
    const result = await pool.query<AgentSnapshot>(
      `SELECT
         id,
         agent_id as "agentId",
         map_id as "mapId",
         components, checks, commands,
         created_at as "createdAt"
       FROM agent_snapshots
       WHERE agent_id = $1 AND map_id = $2`,
      [agentId, mapId]
    );
    return result.rows[0] || null;
  },

  async deleteByAgent(agentId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM agent_snapshots WHERE agent_id = $1',
      [agentId]
    );
    return result.rowCount || 0;
  },
};
