import { getPool } from '../connection.js';
import { Agent, Gateway } from '../../types/index.js';
import { createChildLogger } from '../../config/logger.js';

const logger = createChildLogger('agents-repository');

export interface CreateGatewayParams {
  id: string;
  name: string;
  zone: string;
  url: string;
}

export interface CreateAgentParams {
  id: string;
  gatewayId: string;
  hostname: string;
  labels?: Record<string, string>;
  version?: string;
  os?: string;
}

export const gatewaysRepository = {
  async upsert(params: CreateGatewayParams): Promise<Gateway> {
    const pool = getPool();
    const result = await pool.query<Gateway>(
      `INSERT INTO gateways (id, name, zone, url, status, last_heartbeat, connected_agents)
       VALUES ($1, $2, $3, $4, 'online', NOW(), 0)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         zone = EXCLUDED.zone,
         url = EXCLUDED.url,
         status = 'online',
         last_heartbeat = NOW()
       RETURNING
         id, name, zone, url, status,
         last_heartbeat as "lastHeartbeat",
         connected_agents as "connectedAgents",
         created_at as "createdAt"`,
      [params.id, params.name, params.zone, params.url]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Gateway | null> {
    const pool = getPool();
    const result = await pool.query<Gateway>(
      `SELECT
         id, name, zone, url, status,
         last_heartbeat as "lastHeartbeat",
         connected_agents as "connectedAgents",
         created_at as "createdAt"
       FROM gateways WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async findAll(): Promise<Gateway[]> {
    const pool = getPool();
    const result = await pool.query<Gateway>(
      `SELECT
         id, name, zone, url, status,
         last_heartbeat as "lastHeartbeat",
         connected_agents as "connectedAgents",
         created_at as "createdAt"
       FROM gateways ORDER BY zone, name`
    );
    return result.rows;
  },

  async findOnline(): Promise<Gateway[]> {
    const pool = getPool();
    const result = await pool.query<Gateway>(
      `SELECT
         id, name, zone, url, status,
         last_heartbeat as "lastHeartbeat",
         connected_agents as "connectedAgents",
         created_at as "createdAt"
       FROM gateways
       WHERE status = 'online'
       AND last_heartbeat > NOW() - INTERVAL '2 minutes'`
    );
    return result.rows;
  },

  async heartbeat(id: string, connectedAgents?: number): Promise<void> {
    const pool = getPool();
    if (connectedAgents !== undefined) {
      await pool.query(
        `UPDATE gateways
         SET last_heartbeat = NOW(), status = 'online', connected_agents = $2
         WHERE id = $1`,
        [id, connectedAgents]
      );
    } else {
      await pool.query(
        `UPDATE gateways SET last_heartbeat = NOW(), status = 'online' WHERE id = $1`,
        [id]
      );
    }
  },

  async markOffline(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE gateways SET status = 'offline' WHERE id = $1`, [id]);
  },

  async updateAgentCount(id: string, count: number): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE gateways SET connected_agents = $2 WHERE id = $1`, [id, count]);
  },
};

export const agentsRepository = {
  async upsert(params: CreateAgentParams): Promise<Agent> {
    const pool = getPool();
    const result = await pool.query<Agent>(
      `INSERT INTO agents (id, gateway_id, hostname, labels, version, os, status, last_heartbeat)
       VALUES ($1, $2, $3, $4, $5, $6, 'online', NOW())
       ON CONFLICT (id) DO UPDATE SET
         gateway_id = EXCLUDED.gateway_id,
         hostname = EXCLUDED.hostname,
         labels = EXCLUDED.labels,
         version = EXCLUDED.version,
         os = EXCLUDED.os,
         status = 'online',
         last_heartbeat = NOW()
       RETURNING
         id,
         gateway_id as "gatewayId",
         hostname, labels, status,
         last_heartbeat as "lastHeartbeat",
         version, os,
         created_at as "createdAt"`,
      [
        params.id,
        params.gatewayId,
        params.hostname,
        JSON.stringify(params.labels || {}),
        params.version || null,
        params.os || null,
      ]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Agent | null> {
    const pool = getPool();
    const result = await pool.query<Agent>(
      `SELECT
         id,
         gateway_id as "gatewayId",
         hostname, labels, status,
         last_heartbeat as "lastHeartbeat",
         version, os,
         created_at as "createdAt"
       FROM agents WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async findAll(): Promise<Agent[]> {
    const pool = getPool();
    const result = await pool.query<Agent>(
      `SELECT
         a.id,
         a.gateway_id as "gatewayId",
         a.hostname, a.labels, a.status,
         a.last_heartbeat as "lastHeartbeat",
         a.version, a.os,
         a.created_at as "createdAt"
       FROM agents a
       ORDER BY a.hostname`
    );
    return result.rows;
  },

  async findOnline(): Promise<Agent[]> {
    const pool = getPool();
    const result = await pool.query<Agent>(
      `SELECT
         a.id,
         a.gateway_id as "gatewayId",
         a.hostname, a.labels, a.status,
         a.last_heartbeat as "lastHeartbeat",
         a.version, a.os,
         a.created_at as "createdAt"
       FROM agents a
       WHERE a.status = 'online'
       AND a.last_heartbeat > NOW() - INTERVAL '2 minutes'`
    );
    return result.rows;
  },

  async findByGateway(gatewayId: string): Promise<Agent[]> {
    const pool = getPool();
    const result = await pool.query<Agent>(
      `SELECT
         id,
         gateway_id as "gatewayId",
         hostname, labels, status,
         last_heartbeat as "lastHeartbeat",
         version, os,
         created_at as "createdAt"
       FROM agents
       WHERE gateway_id = $1
       ORDER BY hostname`,
      [gatewayId]
    );
    return result.rows;
  },

  async findByLabels(labels: Record<string, string>): Promise<Agent[]> {
    const pool = getPool();
    // Build JSONB query for label matching
    const conditions = Object.entries(labels).map(([key, value], index) => {
      return `labels ->> $${index * 2 + 1} = $${index * 2 + 2}`;
    });
    const values = Object.entries(labels).flat();

    const result = await pool.query<Agent>(
      `SELECT
         id,
         gateway_id as "gatewayId",
         hostname, labels, status,
         last_heartbeat as "lastHeartbeat",
         version, os,
         created_at as "createdAt"
       FROM agents
       WHERE status = 'online'
       AND ${conditions.join(' AND ')}`,
      values
    );
    return result.rows;
  },

  async heartbeat(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE agents SET last_heartbeat = NOW(), status = 'online' WHERE id = $1`,
      [id]
    );
  },

  async markOffline(id: string): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE agents SET status = 'offline' WHERE id = $1`, [id]);
  },

  async markAllOfflineByGateway(gatewayId: string): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE agents SET status = 'offline' WHERE gateway_id = $1`, [gatewayId]);
  },
};
